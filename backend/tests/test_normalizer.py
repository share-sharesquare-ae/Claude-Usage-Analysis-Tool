from app.normalizer import normalize


def test_otlp_log_normalization_and_privacy():
    payload = {"resourceLogs": [{"resource": {"attributes": [
        {"key": "service.name", "value": {"stringValue": "claude-code"}},
        {"key": "employee.id", "value": {"stringValue": "EMP-1"}},
    ]}, "scopeLogs": [{"logRecords": [{
        "timeUnixNano": "1700000000000000000",
        "attributes": [
            {"key": "event.name", "value": {"stringValue": "api_request"}},
            {"key": "session.id", "value": {"stringValue": "s1"}},
            {"key": "input_tokens", "value": {"intValue": "120"}},
            {"key": "output_tokens", "value": {"intValue": "30"}},
            {"key": "cost_usd", "value": {"doubleValue": 0.01}},
            {"key": "prompt", "value": {"stringValue": "secret"}},
        ]
    }]}]}]}
    event = normalize(payload)[0]
    assert event.service == "claude-code"
    assert event.employee_id == "EMP-1"
    assert event.input_tokens == 120
    assert event.output_tokens == 30
    assert event.cost_usd == 0.01
    assert "prompt" not in event.attributes

