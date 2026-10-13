import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { reportFailure } from "./fileSessionStore";
import { resetSession, session } from "./sessionFixture";
import { flush } from "../test/flush";

beforeEach(resetSession);

describe("reportFailure", () => {
  it("puts a rejection's message on the session", async () => {
    reportFailure(Promise.reject({ kind: "io", message: "no such file" }));
    await flush();
    expect(session().error).toBe("no such file");
  });

  it("leaves the session alone when the promise resolves", async () => {
    reportFailure(Promise.resolve());
    await flush();
    expect(session().error).toBeNull();
  });
});
