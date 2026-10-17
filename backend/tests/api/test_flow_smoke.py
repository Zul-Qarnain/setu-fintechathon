def test_chat_pay_tuition_t3(world):
    r = world.client.post("/chat", json={"message": "Pay my spring tuition", "locale": "en"}, headers=world.student.h)
    assert r.status_code == 200, r.text
    j = r.json()
    print(j["reply"])
    assert j["intent"] == "pay_obligation"
    assert j["proposed_actions"][0]["tier"] == "T3"
    assert j["trace"]["reply_validated"] is True
