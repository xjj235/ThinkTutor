export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getActiveManifests, getRuntimeManifests } = await import("./lib/knowledge/releases");
    getActiveManifests();
    if (process.env.DEPLOYMENT_ENV === "production" && !(await getRuntimeManifests()).length) throw new Error("Production requires a reviewed, published knowledge release");
  }
}
