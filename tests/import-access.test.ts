/**
 * Tests for the import access rules.
 *
 * These decide who may write files to the machine running the server, so the
 * boundary matters more than the happy path: a request from the internet must
 * not be able to import, with or without a token configured.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideImportAccess,
  hostnameOf,
  isLoopbackHost,
  isPrivateHost,
} from "../src/lib/import/access.ts";

function request(host: string, token?: string): Request {
  const headers = new Headers({ host });
  if (token !== undefined) headers.set("x-upload-token", token);
  return new Request("http://reader.test/api/import", { method: "POST", headers });
}

describe("hostnameOf", () => {
  it("strips the port and any IPv6 brackets", () => {
    assert.equal(hostnameOf(request("localhost:3100")), "localhost");
    assert.equal(hostnameOf(request("192.168.0.193:3100")), "192.168.0.193");
    assert.equal(hostnameOf(request("[::1]:3100")), "::1");
  });
});

describe("isLoopbackHost", () => {
  it("accepts this machine", () => {
    for (const host of ["localhost", "127.0.0.1", "127.1.2.3", "::1"]) {
      assert.equal(isLoopbackHost(host), true, host);
    }
  });

  it("rejects a LAN address", () => {
    assert.equal(isLoopbackHost("192.168.0.193"), false);
  });
});

describe("isPrivateHost", () => {
  it("accepts the private ranges", () => {
    for (const host of ["10.0.0.5", "192.168.1.1", "172.16.0.1", "172.31.255.254", "169.254.1.1"]) {
      assert.equal(isPrivateHost(host), true, host);
    }
  });

  it("rejects addresses just outside 172.16/12 and public ones", () => {
    for (const host of ["172.15.0.1", "172.32.0.1", "8.8.8.8", "203.0.113.9"]) {
      assert.equal(isPrivateHost(host), false, host);
    }
  });

  it("accepts local network names but not public domains", () => {
    assert.equal(isPrivateHost("nas.local"), true);
    assert.equal(isPrivateHost("reader.lan"), true);
    assert.equal(isPrivateHost("example.com"), false);
    // Nothing stops a name being crafted to end with a local suffix on a public
    // host, so a real deployment wants the token below.
    assert.equal(isPrivateHost("evil.local"), true);
  });
});

describe("decideImportAccess without a token", () => {
  it("allows this machine", () => {
    assert.equal(decideImportAccess(request("localhost:3100"), undefined).allowed, true);
  });

  it("allows the local network, which is the configured default", () => {
    assert.equal(decideImportAccess(request("192.168.0.193:3100"), undefined).allowed, true);
  });

  it("refuses a public host, so a forwarded port is not writable", () => {
    const decision = decideImportAccess(request("reader.example.com"), undefined);
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 403);
    assert.match(String(decision.reason), /local network/i);
  });
});

describe("decideImportAccess with a token", () => {
  const token = "s3cret-token-value";

  it("still allows this machine without the token", () => {
    assert.equal(decideImportAccess(request("localhost:3100"), token).allowed, true);
  });

  it("allows a network request that presents the token", () => {
    assert.equal(decideImportAccess(request("192.168.0.5:3100", token), token).allowed, true);
  });

  it("refuses a network request with the wrong token", () => {
    const decision = decideImportAccess(request("192.168.0.5:3100", "wrong"), token);
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 401);
  });

  it("refuses a network request with no token at all", () => {
    const decision = decideImportAccess(request("192.168.0.5:3100"), token);
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 401);
  });

  it("does not accept a token that merely shares a prefix", () => {
    const decision = decideImportAccess(request("192.168.0.5:3100", "s3cret"), token);
    assert.equal(decision.allowed, false);
  });
});
