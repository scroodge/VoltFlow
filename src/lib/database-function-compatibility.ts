export function isMissingDatabaseFunction(
  error: { code?: string; message?: string },
  functionName: string,
) {
  const message = error.message?.toLowerCase() ?? "";
  const normalizedFunctionName = functionName.toLowerCase();
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    (message.includes(normalizedFunctionName) &&
      (message.includes("does not exist") ||
        message.includes("could not find") ||
        message.includes("schema cache")))
  );
}
