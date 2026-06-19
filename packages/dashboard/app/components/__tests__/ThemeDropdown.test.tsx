import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { COLOR_THEMES } from "../themeOptions";
import { ThemeDropdown } from "../ThemeDropdown";

describe("ThemeDropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the current theme chip and opens all swatched theme options", () => {
    render(<ThemeDropdown colorTheme="ocean" onColorThemeChange={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: /ocean/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(within(trigger).getByText("Ocean")).toBeDefined();
    expect(trigger.querySelector(".theme-swatch-ocean")).toBeTruthy();

    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox", { name: /color theme/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    for (const theme of COLOR_THEMES) {
      const option = within(listbox)
        .getAllByRole("option")
        .find((element) => element.textContent?.trim().startsWith(theme.label));
      expect(option?.querySelector(`.${theme.className}`)).toBeTruthy();
    }
  });

  it("selects themes and closes from click, escape, and outside click", () => {
    const onColorThemeChange = vi.fn();
    render(<ThemeDropdown colorTheme="default" onColorThemeChange={onColorThemeChange} />);

    fireEvent.click(screen.getByRole("button", { name: /default/i }));
    fireEvent.click(screen.getAllByRole("option").find((element) => element.textContent?.trim() === "Forest")!);
    expect(onColorThemeChange).toHaveBeenCalledWith("forest");
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /default/i }));
    fireEvent.keyDown(screen.getByRole("option", { name: /default/i }), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /default/i }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("is keyboard-operable with arrows and enter", () => {
    const onColorThemeChange = vi.fn();
    render(<ThemeDropdown colorTheme="default" onColorThemeChange={onColorThemeChange} />);

    const trigger = screen.getByRole("button", { name: /default/i });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("option", { name: /default/i }), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("option", { name: /ocean/i }), { key: "Enter" });

    expect(onColorThemeChange).toHaveBeenCalledWith("ocean");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("renders compact theme mode controls when mode props are supplied", () => {
    const onThemeModeChange = vi.fn();
    render(
      <ThemeDropdown
        colorTheme="default"
        themeMode="dark"
        onColorThemeChange={vi.fn()}
        onThemeModeChange={onThemeModeChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /light/i }));
    expect(onThemeModeChange).toHaveBeenCalledWith("light");
  });
});
