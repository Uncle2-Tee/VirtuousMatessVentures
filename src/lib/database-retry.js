const transientDatabaseErrorCodes = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2028"]);
const databaseQueryRetryDelays = [500, 1000, 2000, 4000];

export function isTransientDatabaseError(error) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return transientDatabaseErrorCodes.has(code)
    || (error?.name === "PrismaClientInitializationError" && /Can't reach database server/i.test(error.message || ""));
}

export async function withDatabaseRetry(operation) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const retryDelay = databaseQueryRetryDelays[attempt];
      if (!isTransientDatabaseError(error) || retryDelay === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
}
