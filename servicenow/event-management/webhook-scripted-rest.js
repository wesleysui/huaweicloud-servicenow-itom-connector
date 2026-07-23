// POST /api/x_hwc/itom/webhook/ces_alarm - Huawei Cloud Eye alarm webhook via SMN.
// SMN wraps every push in an envelope (type/message_id/topic_urn/message/...);
// the real CES alarm JSON is a STRING inside envelope.message, not the top-level
// body. Also handles the SubscriptionConfirmation handshake SMN requires before
// it will deliver real notifications. See servicenow/event-management/README.md.
(function process(/* RESTAPIRequest */ request, /* RESTAPIResponse */ response) {
    try {
        // Shared-secret header check against a System Property (scope-prefixed - read via gs.getCurrentScopeName()).
        var expectedSecret = gs.getProperty(gs.getCurrentScopeName() + '.x_hwc.itom.webhook_secret');
        var providedSecret  = request.getHeader('X-Webhook-Secret');
        if (!expectedSecret || providedSecret !== expectedSecret) {
            // Log presence/length only - never the secret values themselves.
            gs.error('[HuaweiCESWebhook] Unauthorized - expected secret configured: ' + !!expectedSecret + ', header present: ' + !!providedSecret + ', header length: ' + (providedSecret ? providedSecret.length : 0));
            response.setStatus(401);
            response.setBody({ error: 'Unauthorized' });
            return;
        }

        var envelope = request.body.data; // parsed JSON from SMN

        if (!envelope || !envelope.type) {
            response.setStatus(400);
            response.setBody({ error: 'Missing or invalid SMN envelope' });
            return;
        }

        // SMN requires confirming new (or cancelled) subscriptions by GETing subscribe_url within 48h.
        if (envelope.type === 'SubscriptionConfirmation' || envelope.type === 'UnsubscribeConfirmation') {
            gs.info('[HuaweiCESWebhook] ' + envelope.type + ' received, confirm url: ' + envelope.subscribe_url);
            if (envelope.subscribe_url) {
                try {
                    var confirmReq = new sn_ws.RESTMessageV2();
                    confirmReq.setHttpMethod('GET');
                    confirmReq.setEndpoint(envelope.subscribe_url);
                    confirmReq.execute();
                } catch (confirmEx) {
                    gs.error('[HuaweiCESWebhook] subscription confirm request failed: ' + confirmEx.message);
                }
            }
            response.setStatus(200);
            response.setBody({ result: 'ack', type: envelope.type });
            return;
        }

        if (envelope.type !== 'Notification') {
            response.setStatus(200);
            response.setBody({ result: 'ignored', type: envelope.type });
            return;
        }

        var body;
        try {
            body = JSON.parse(envelope.message);
        } catch (parseEx) {
            gs.error('[HuaweiCESWebhook] could not parse envelope.message: ' + parseEx.message);
            response.setStatus(400);
            response.setBody({ error: 'Unparseable notification message' });
            return;
        }

        if (!body || !body.alarm_id) {
            // Unrecognized shape - capture it for inspection instead of silently dropping it.
            var raw = new GlideRecord('em_event');
            raw.initialize();
            raw.source = 'Huawei Cloud Eye';
            raw.description = 'Unrecognized CES notification shape - see additional_info';
            raw.severity = 4;
            raw.additional_info = JSON.stringify(envelope);
            raw.insert();
            response.setStatus(202);
            response.setBody({ result: 'accepted_unmapped' });
            return;
        }

        // Real CES notifications: no top-level alarm_level (severity is template_variable.AlarmLevel,
        // a string); "dimension" is a single "key:value" string, not an array/object; "resource_name"
        // and "condition" don't exist at the top level at all. See servicenow/event-management/README.md.
        var LEVEL_MAP = { Critical: 1, Major: 2, Minor: 3, Informational: 4 };
        var tv = body.template_variable || {};

        var instanceId = tv.ResourceId || '';
        if (!instanceId && typeof body.dimension === 'string') {
            var colonIdx = body.dimension.indexOf(':');
            if (colonIdx !== -1 && body.dimension.slice(0, colonIdx) === 'instance_id') {
                instanceId = body.dimension.slice(colonIdx + 1);
            }
        }

        var ev = new GlideRecord('em_event');
        ev.initialize();
        ev.source         = 'Huawei Cloud Eye';
        ev.type           = body.metric_name;
        ev.resource        = instanceId;
        // node is informational only - CI binding uses resource (correlation_id match), configured in the Event Rule's Binding step.
        ev.node             = tv.ResourceName || instanceId;
        // alarm_status "ok" (recovered) always maps to 5 (OK/Clear), regardless of AlarmLevel.
        ev.severity          = (body.alarm_status === 'ok') ? 5 : (LEVEL_MAP[tv.AlarmLevel] || 4);
        ev.description        = body.default_content || ((body.alarm_name || '') + ' - ' + body.value + body.unit);
        // real CES notifications send time as epoch milliseconds (a number), not the ISO 8601 string originally assumed - handle both, and never let a time format surprise block the insert.
        try {
            if (typeof body.time === 'number') {
                var gdt = new GlideDateTime();
                gdt.setNumericValue(body.time);
                ev.time_of_event = gdt;
            } else if (typeof body.time === 'string') {
                ev.time_of_event = body.time.replace('T', ' ').replace('Z', '');
            }
        } catch (timeEx) {
            gs.error('[HuaweiCESWebhook] could not set time_of_event from ' + body.time + ': ' + timeEx.message);
        }
        ev.additional_info = JSON.stringify(body);
        ev.insert();

        response.setStatus(202);
        response.setBody({ result: 'accepted', sys_id: ev.getUniqueValue() });
    } catch (ex) {
        gs.error('[HuaweiCESWebhook] ' + ex.message);
        response.setStatus(500);
        response.setBody({ error: 'Internal error processing alarm payload' });
    }
})(request, response);
