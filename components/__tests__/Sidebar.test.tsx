import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "@/components/Sidebar";

// Mock next/link and next/image
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({ alt, ...props }: any) => <img alt={alt} {...props} />,
}));

// Mock i18n
const mockT = {
  nav_home: "Home",
  nav_explore: "Explore",
  nav_timelines: "Timelines",
  nav_notifications: "Notifications",
  nav_messages: "Messages",
  nav_bookmarks: "Bookmarks",
  nav_favourites: "Favourites",
  nav_lists: "Lists",
  nav_followed_tags: "Hashtags",
  nav_mutes: "Mutes",
  nav_scheduled: "Scheduled",
  nav_profile: "Profile",
  nav_settings: "Settings",
  nav_logout: "Log out",
  theme_light: "Light",
  theme_dark: "Dark",
};

vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: mockT,
    locale: "en" as const,
    setLocale: vi.fn(),
  }),
}));

// Mock getToken
vi.mock("@/lib/client-api", () => ({
  getToken: vi.fn(() => null),
}));

// Mock useTimelineStream
vi.mock("@/lib/streaming/use-timeline-stream", () => ({
  useTimelineStream: vi.fn(),
}));

// Mock global fetch to prevent network requests in tests
const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.clearAllMocks();
});

describe("Sidebar", () => {
  it("renders the logo and app name", () => {
    render(<Sidebar me={null} currentPath="/home" />);
    expect(screen.getByText("CF ActivityPub")).toBeInTheDocument();
    expect(screen.getByAltText("CF ActivityPub")).toBeInTheDocument();
  });

  it("renders all navigation items", () => {
    render(<Sidebar me={null} currentPath="/home" />);
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Explore")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("Messages")).toBeInTheDocument();
  });

  it("highlights the current path nav item", () => {
    render(<Sidebar me={null} currentPath="/home" />);
    const homeLink = screen.getByText("Home").closest("a");
    expect(homeLink?.getAttribute("style")).toContain("var(--accent-bg)");
  });

  it("shows theme toggle button", () => {
    render(<Sidebar me={null} currentPath="/home" />);
    const buttons = screen.getAllByTitle("Light");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    const sunIcons = screen.getAllByText("☀️");
    expect(sunIcons.length).toBeGreaterThanOrEqual(1);
  });

  it("renders logout button when not authenticated", () => {
    render(<Sidebar me={null} currentPath="/home" />);
    expect(screen.getByText((content) => content.includes("Log out"))).toBeInTheDocument();
  });

  it("renders user info when me prop is provided", () => {
    const me = { username: "alice", display_name: "Alice", acct: "alice@example.com" };
    render(<Sidebar me={me} currentPath="/home" />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("@alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("renders language toggle buttons", () => {
    render(<Sidebar me={null} currentPath="/home" />);
    expect(screen.getByText("EN")).toBeInTheDocument();
    expect(screen.getByText("ES")).toBeInTheDocument();
  });

  it("renders mobile bottom nav with theme toggle", () => {
    render(<Sidebar me={null} currentPath="/home" />);
    const mobileThemeBtn = screen.getAllByTitle("Light");
    expect(mobileThemeBtn.length).toBeGreaterThanOrEqual(2);
  });
});
