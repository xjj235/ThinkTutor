export function GET() {
  return Response.json(
    { ok: true, service: "thinktutor" },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
