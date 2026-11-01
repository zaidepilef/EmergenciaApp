import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "@/app/page";

describe("Home", () => {
  it("muestra el estado inicial del workspace", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { level: 1, name: /brigada emergencias/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/etapa 0 completada/i)).toBeInTheDocument();
    expect(screen.getByText(/todavía no hay módulos funcionales/i)).toBeInTheDocument();
  });
});
