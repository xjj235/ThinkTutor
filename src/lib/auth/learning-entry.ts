/** Only the existing student task route may continue through authentication. */
export function learningEntryDestination(candidate: unknown): "/learn/new" | undefined {
  return candidate === "/learn/new" ? "/learn/new" : undefined;
}
