export async function* simulateStream(
  prompt: string,
): AsyncGenerator<string> {
  const responses: Record<string, string> = {
    q2: "Q2 revenue was up 18% YoY, driven primarily by the new institutional trading desk and higher deposit yields.",
    default:
      "I have received your query. Analyzing the financial data models now. Please hold on.",
  };
  const key =
    Object.keys(responses).find((entry) =>
      prompt.toLowerCase().includes(entry),
    ) ?? "default";
  const words = responses[key].split(" ");

  for (const word of words) {
    yield `${word} `;
    await new Promise((resolve) =>
      setTimeout(resolve, 60 + Math.random() * 60),
    );
  }
}
