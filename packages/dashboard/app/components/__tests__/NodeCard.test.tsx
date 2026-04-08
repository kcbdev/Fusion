import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NodeCard } from "../NodeCard";
import type { NodeInfo, ProjectInfo } from "../../api";

vi.mock("lucide-react", () => ({
  Activity: () => <span data-testid="activity-icon">activity</span>,
  Server: () => <span data-testid="server-icon">server</span>,
  Settings: () => <span data-testid="settings-icon">settings</span>,
  Trash2: () => <span data-testid="trash-icon">trash</span>,
}));

function makeNode(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return {
    id: "node-1",
    name: "Primary Node",
    type: "local",
    status: "online",
    maxConcurrent: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id: "proj-1",
    name: "Project One",
    path: "/workspace/project-one",
    status: "active",
    isolationMode: "in-process",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("NodeCard", () => {
  it("renders node name, type, status, project count, and concurrency", () => {
    const node = makeNode({ id: "node-abc", name: "Build Worker", type: "remote", status: "connecting", url: "https://remote.example.com" });
    const projects = [
      makeProject({ id: "proj-a", nodeId: "node-abc" }),
      makeProject({ id: "proj-b", nodeId: "node-abc" }),
      makeProject({ id: "proj-c", nodeId: "other-node" }),
    ];

    render(
      <NodeCard
        node={node}
        projects={projects}
        onHealthCheck={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByText("Build Worker")).toBeDefined();
    expect(screen.getByText("Remote")).toBeDefined();
    expect(screen.getByText("Connecting")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText("https://remote.example.com")).toBeDefined();
  });

  it("maps status classes correctly", () => {
    const { rerender } = render(
      <NodeCard
        node={makeNode({ status: "online" })}
        projects={[]}
        onHealthCheck={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByText("Online").className).toContain("node-card__status--online");

    rerender(
      <NodeCard
        node={makeNode({ status: "offline" })}
        projects={[]}
        onHealthCheck={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByText("Offline").className).toContain("node-card__status--offline");

    rerender(
      <NodeCard
        node={makeNode({ status: "error" })}
        projects={[]}
        onHealthCheck={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByText("Error").className).toContain("node-card__status--error");
  });

  it("fires health check and edit callbacks", () => {
    const node = makeNode();
    const onHealthCheck = vi.fn();
    const onEdit = vi.fn();

    render(
      <NodeCard
        node={node}
        projects={[]}
        onHealthCheck={onHealthCheck}
        onEdit={onEdit}
        onRemove={vi.fn()}
      />
    );

    fireEvent.click(screen.getByLabelText("Run node health check"));
    expect(onHealthCheck).toHaveBeenCalledWith(node.id);

    fireEvent.click(screen.getByLabelText("Edit node"));
    expect(onEdit).toHaveBeenCalledWith(node);
  });

  it("requires a second click to confirm remove", () => {
    const onRemove = vi.fn();
    const node = makeNode();

    render(
      <NodeCard
        node={node}
        projects={[]}
        onHealthCheck={vi.fn()}
        onEdit={vi.fn()}
        onRemove={onRemove}
      />
    );

    const removeButton = screen.getByLabelText("Remove node");
    fireEvent.click(removeButton);

    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByText("Confirm")).toBeDefined();

    fireEvent.click(screen.getByLabelText("Confirm remove node"));
    expect(onRemove).toHaveBeenCalledWith(node.id);
  });
});
