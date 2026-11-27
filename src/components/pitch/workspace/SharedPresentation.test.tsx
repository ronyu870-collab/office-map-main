import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { pitchSharePath } from "@/src/lib/pitch/workspace/shareLink";
import { SharedPresentation } from "./SharedPresentation";

const shareId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const pages = [
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "共享封面" },
  { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "共享指标" },
];
const state = vi.hoisted(() => ({
  status: "authenticated",
  userId: "reader",
  effectiveId: "reader",
  token: "header.eyJzZXNzaW9uX2lkIjoiZGRkZGRkZGQtZGRkZC00ZGRkLThkZGQtZGRkZGRkZGRkZGRkIn0.signature",
}));
vi.mock("@/src/components/SessionProvider", () => ({
  useAppSession: () => ({ status: state.status, session: {
    user: { id: state.effectiveId },
    session: { user: { id: state.userId }, access_token: state.token },
  } }),
}));
vi.mock("@/src/services/supabaseClient", () => ({
  supabase: { auth: { getSession: async () => ({ data: {
    session: { user: { id: state.userId }, access_token: state.token },
  } }) } },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  state.status = "authenticated";
  state.effectiveId = "reader";
  state.userId = "reader";
});

it("opens only the shared pages with the recipient token and removes the preview on a denied page", async () => {
  const createObjectURL = vi.fn().mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  let revoked = false;
  const fetcher = vi.fn(async (input: string, options: RequestInit) => {
    const query = new URL(input, "https://example.test").searchParams;
    expect(query.get("shareId")).toBe(shareId);
    expect(options).toMatchObject({ headers: { Authorization: "Bearer " + state.token }, cache: "no-store" });
    if (revoked) return new Response(null, { status: 403 });
    if (query.get("action") === "shared_presentation") return Response.json({ id: shareId, title: "冻结项目", pages });
    expect(query.get("action")).toBe("shared_slide");
    const slide = pages.find(page => page.id === query.get("slideId"));
    return Response.json({ id: slide?.id, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<SharedPresentation shareId={shareId} />);
  expect(await screen.findByRole("img", { name: "共享封面" })).toHaveAttribute("src", "blob:first");
  fireEvent.keyDown(screen.getByRole("button", { name: "下一页" }), { key: "End" });
  expect(await screen.findByRole("img", { name: "共享指标" })).toHaveAttribute("src", "blob:second");
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
  revoked = true;
  fireEvent.click(screen.getByRole("button", { name: "上一页" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("当前账号没有查阅权限");
  expect(screen.queryByText("冻结项目")).not.toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:second");
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("offers the constrained login return and does not fetch under an impersonated account", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  state.status = "unauthenticated";
  const view = render(<SharedPresentation shareId={shareId} />);
  expect(screen.getByRole("link", { name: "登录查看演示" })).toHaveAttribute("href", "/login?pitchShare=" + shareId);
  expect(pitchSharePath(shareId.toUpperCase())).toBe("/intelligence/pitch/shared/" + shareId);
  expect(pitchSharePath("//other.example")).toBeUndefined();
  state.status = "authenticated";
  state.effectiveId = "impersonated";
  view.rerender(<SharedPresentation shareId={shareId} />);
  expect(screen.getByRole("alert")).toHaveTextContent("退出模拟身份");
  await waitFor(() => expect(fetcher).not.toHaveBeenCalled());
});
