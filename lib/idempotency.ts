export function hasDuplicateClientRequest(
  messages: { clientRequestId: string | null }[],
  clientRequestId: string,
) {
  return messages.some((message) => message.clientRequestId === clientRequestId);
}
