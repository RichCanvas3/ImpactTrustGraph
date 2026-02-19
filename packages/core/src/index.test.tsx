import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HelloMessage, useToggle } from "./index";

describe("HelloMessage", () => {
  it("renders default greeting", () => {
    render(<HelloMessage />);
    expect(screen.getByText("Hello, world!")).toBeInTheDocument();
  });

  it("renders custom name", () => {
    render(<HelloMessage name="Alice" />);
    expect(screen.getByText("Hello, Alice!")).toBeInTheDocument();
  });
});

describe("useToggle", () => {
  function TestToggle() {
    const { on, toggle } = useToggle(false);
    return (
      <button type="button" onClick={toggle}>
        {on ? "on" : "off"}
      </button>
    );
  }

  it("toggles state when clicked", () => {
    render(<TestToggle />);
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("off");
    fireEvent.click(button);
    expect(button).toHaveTextContent("on");
  });
});


