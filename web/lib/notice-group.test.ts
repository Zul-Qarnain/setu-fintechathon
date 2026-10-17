import { expect, it } from "vitest";
import { noticeGroup } from "./notice-group";

it("groups demo notices by the category in their label", () => {
  expect(noticeGroup({ id: "a", label: "atk_injection_en_01.txt (injection, SYNTHETIC)", text: "" })).toBe("injection");
  expect(noticeGroup({ id: "b", label: "en_tuition_aisha.txt (clean, SYNTHETIC)", text: "" })).toBe("clean");
  expect(noticeGroup({ id: "c", label: "whatever", text: "" })).toBe("other");
});
