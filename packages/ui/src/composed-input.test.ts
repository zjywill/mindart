// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { bindComposedInput } from "./composed-input.js";

function textarea(): HTMLTextAreaElement {
  const field = document.createElement("textarea");
  document.body.append(field);
  return field;
}

function type(field: HTMLTextAreaElement, value: string, isComposing = false) {
  field.value = value;
  field.dispatchEvent(new InputEvent("input", { isComposing }));
}

describe("bindComposedInput", () => {
  it("commits plain typing on every input event", () => {
    const field = textarea();
    const commit = vi.fn();
    bindComposedInput(field, commit);

    type(field, "a");
    type(field, "ab");

    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("stays silent through an IME composition and commits once at the end", () => {
    const field = textarea();
    const commit = vi.fn();
    bindComposedInput(field, commit);

    field.dispatchEvent(new CompositionEvent("compositionstart"));
    type(field, "n", true);
    type(field, "ni", true);
    type(field, "nihao", true);
    expect(commit).not.toHaveBeenCalled();

    field.value = "你好";
    field.dispatchEvent(new CompositionEvent("compositionend"));

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("ignores input flagged as composing even without a compositionstart", () => {
    const field = textarea();
    const commit = vi.fn();
    bindComposedInput(field, commit);

    type(field, "zh", true);

    expect(commit).not.toHaveBeenCalled();
  });

  it("resumes committing after a composition finishes", () => {
    const field = textarea();
    const commit = vi.fn();
    bindComposedInput(field, commit);

    field.dispatchEvent(new CompositionEvent("compositionstart"));
    type(field, "h", true);
    field.value = "好";
    field.dispatchEvent(new CompositionEvent("compositionend"));
    commit.mockClear();

    type(field, "好!");

    expect(commit).toHaveBeenCalledTimes(1);
  });
});
