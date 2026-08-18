import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEvaluateReport = vi.hoisted(() => vi.fn());
const mockGetObjectById = vi.hoisted(() => vi.fn());
const mockSuspendAccount = vi.hoisted(() => vi.fn());
const mockWarnAccount = vi.hoisted(() => vi.fn());
const mockDeleteStatus = vi.hoisted(() => vi.fn());
const mockResolveReport = vi.hoisted(() => vi.fn());
const mockDismissReport = vi.hoisted(() => vi.fn());
const mockRecordNoAction = vi.hoisted(() => vi.fn());
const mockSendReportOutcomeEmail = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  getObjectById: mockGetObjectById,
}));

vi.mock("@/lib/moderation/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/moderation/ai")>();
  return { ...actual, evaluateReport: mockEvaluateReport };
});

vi.mock("@/lib/moderation/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/moderation/actions")>();
  return {
    ...actual,
    suspendAccount: mockSuspendAccount,
    warnAccount: mockWarnAccount,
    deleteStatus: mockDeleteStatus,
    resolveReport: mockResolveReport,
    dismissReport: mockDismissReport,
    recordNoAction: mockRecordNoAction,
  };
});

vi.mock("@/lib/email", () => ({
  sendReportOutcomeEmail: mockSendReportOutcomeEmail,
}));

import { evaluateReportWithAI } from "@/lib/moderation/reportAI";

const BASE_INPUT = {
  reportId: "rep-1",
  category: "spam",
  comment: "spam account",
  statusIds: ["s1", "s2"],
  domain: "local.example",
  target: { id: "actor-target", username: "spammer" },
  reporter: { id: "actor-reporter", username: "whistle", email: "whistle@example.com" },
};

const ENV = {
  DB: {},
  EMAIL: {},
  FROM_EMAIL: "noreply@local.example",
  INSTANCE_TITLE: "Test",
} as unknown as Parameters<typeof evaluateReportWithAI>[0];

function makeObject(actorId: string, content: string) {
  return {
    id: `https://remote.example/objects/${actorId}`,
    actorId,
    content,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetObjectById.mockImplementation(async (_db: unknown, id: string) => {
    if (id === "s1") return makeObject("actor-target", "<p>buy now</p>");
    if (id === "s2") return makeObject("actor-target", "<p>click here</p>");
    return null;
  });
  mockSuspendAccount.mockResolvedValue({ action: "suspended", applied: true, emailSent: false });
  mockWarnAccount.mockResolvedValue({ action: "warned", applied: true, emailSent: false });
  mockDeleteStatus.mockResolvedValue({ action: "deleted", applied: true, emailSent: false });
  mockResolveReport.mockResolvedValue({ action: "resolved", applied: true, emailSent: false });
  mockDismissReport.mockResolvedValue({ action: "dismissed", applied: true, emailSent: false });
  mockRecordNoAction.mockResolvedValue(undefined);
  mockSendReportOutcomeEmail.mockResolvedValue(undefined);
});

describe("evaluateReportWithAI", () => {
  it("records no_action when the model returns nothing", async () => {
    mockEvaluateReport.mockResolvedValue(null);
    await evaluateReportWithAI(ENV, BASE_INPUT);

    expect(mockRecordNoAction).toHaveBeenCalledTimes(1);
    expect(mockRecordNoAction.mock.calls[0][1]).toMatchObject({ targetId: "rep-1", action: "no_action", targetType: "report" });
    expect(mockSuspendAccount).not.toHaveBeenCalled();
    expect(mockResolveReport).not.toHaveBeenCalled();
  });

  it("records no_action on low-confidence verdicts (keeps the ticket open)", async () => {
    mockEvaluateReport.mockResolvedValue({ action: "suspend", reason: "maybe spam", confidence: "low" });
    await evaluateReportWithAI(ENV, BASE_INPUT);

    expect(mockRecordNoAction).toHaveBeenCalledTimes(1);
    expect(mockSuspendAccount).not.toHaveBeenCalled();
    expect(mockResolveReport).not.toHaveBeenCalled();
    expect(mockSendReportOutcomeEmail).not.toHaveBeenCalled();
  });

  it("suspends the target on a high-confidence suspend verdict and resolves", async () => {
    mockEvaluateReport.mockResolvedValue({ action: "suspend", reason: "definite spam", confidence: "high" });
    await evaluateReportWithAI(ENV, BASE_INPUT);

    expect(mockSuspendAccount).toHaveBeenCalledTimes(1);
    expect(mockSuspendAccount.mock.calls[0][1]).toMatchObject({ actorId: "actor-target", source: "ai", relatedId: "rep-1" });
    expect(mockResolveReport).toHaveBeenCalledTimes(1);
    expect(mockResolveReport.mock.calls[0][1]).toMatchObject({ reportId: "rep-1", source: "ai" });
    expect(mockDismissReport).not.toHaveBeenCalled();
  });

  it("deletes each reviewed status on a delete verdict", async () => {
    mockEvaluateReport.mockResolvedValue({ action: "delete", reason: "illegal content", confidence: "high" });
    await evaluateReportWithAI(ENV, BASE_INPUT);

    expect(mockDeleteStatus).toHaveBeenCalledTimes(2);
    const deletedIds = mockDeleteStatus.mock.calls.map((c) => c[1].objectId);
    expect(deletedIds).toEqual(["s1", "s2"]);
    expect(mockResolveReport).toHaveBeenCalledTimes(1);
  });

  it("warns the target on a warn verdict", async () => {
    mockEvaluateReport.mockResolvedValue({ action: "warn", reason: "borderline", confidence: "medium" });
    await evaluateReportWithAI(ENV, BASE_INPUT);

    expect(mockWarnAccount).toHaveBeenCalledTimes(1);
    expect(mockWarnAccount.mock.calls[0][1]).toMatchObject({ actorId: "actor-target", source: "ai" });
    expect(mockResolveReport).toHaveBeenCalledTimes(1);
  });

  it("dismisses without resolving on a dismiss verdict", async () => {
    mockEvaluateReport.mockResolvedValue({ action: "dismiss", reason: "unfounded report", confidence: "high" });
    await evaluateReportWithAI(ENV, BASE_INPUT);

    expect(mockDismissReport).toHaveBeenCalledTimes(1);
    expect(mockDismissReport.mock.calls[0][1]).toMatchObject({ reportId: "rep-1", source: "ai" });
    expect(mockResolveReport).not.toHaveBeenCalled();
  });

  it("dismisses without AI when all reported statuses belong to someone else", async () => {
    mockGetObjectById.mockImplementation(async (_db: unknown, id: string) => {
      if (id === "s1") return makeObject("someone-else", "<p>not theirs</p>");
      if (id === "s2") return makeObject("someone-else", "<p>not theirs either</p>");
      return null;
    });
    await evaluateReportWithAI(ENV, BASE_INPUT);

    expect(mockEvaluateReport).not.toHaveBeenCalled();
    expect(mockDismissReport).toHaveBeenCalledTimes(1);
    expect(mockDismissReport.mock.calls[0][1]).toMatchObject({
      reportId: "rep-1",
      source: "heuristic",
      confidence: "high",
    });
    expect(mockResolveReport).not.toHaveBeenCalled();
  });

  it("dismisses without AI when none of the reported statuses exist", async () => {
    mockGetObjectById.mockResolvedValue(null);
    await evaluateReportWithAI(ENV, BASE_INPUT);

    expect(mockEvaluateReport).not.toHaveBeenCalled();
    expect(mockDismissReport).toHaveBeenCalledTimes(1);
    expect(mockDismissReport.mock.calls[0][1]).toMatchObject({
      reportId: "rep-1",
      source: "heuristic",
      reason: expect.stringContaining("ninguna de las publicaciones"),
    });
  });

  it("records no_action without AI when there is nothing to review", async () => {
    mockGetObjectById.mockResolvedValue({ id: "https://remote.example/objects/s1", actorId: "actor-target", content: "" });
    await evaluateReportWithAI(ENV, { ...BASE_INPUT, comment: "", statusIds: ["s1"] });

    expect(mockEvaluateReport).not.toHaveBeenCalled();
    expect(mockRecordNoAction).toHaveBeenCalledTimes(1);
    expect(mockRecordNoAction.mock.calls[0][1]).toMatchObject({ targetId: "rep-1", targetType: "report" });
    expect(mockDismissReport).not.toHaveBeenCalled();
    expect(mockSendReportOutcomeEmail).not.toHaveBeenCalled();
  });

  it("emails the reporter about the outcome when an address is available", async () => {
    mockEvaluateReport.mockResolvedValue({ action: "suspend", reason: "spam", confidence: "high" });
    await evaluateReportWithAI(ENV, BASE_INPUT);

    expect(mockSendReportOutcomeEmail).toHaveBeenCalledTimes(1);
    expect(mockSendReportOutcomeEmail.mock.calls[0][0]).toBe(ENV.EMAIL);
    expect(mockSendReportOutcomeEmail.mock.calls[0][1]).toMatchObject({
      to: "whistle@example.com",
      reporterUsername: "whistle",
      targetUsername: "spammer",
      action: "suspend",
    });
  });

  it("does not email when the reporter has no email address", async () => {
    mockEvaluateReport.mockResolvedValue({ action: "warn", reason: "spam", confidence: "high" });
    await evaluateReportWithAI(ENV, { ...BASE_INPUT, reporter: { id: "r", username: "anon" } });
    expect(mockSendReportOutcomeEmail).not.toHaveBeenCalled();
  });
});