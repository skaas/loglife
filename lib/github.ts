import type { AppConfig } from "./config.js";

type GitHubFile = {
  content: string;
  sha: string;
};

class GitHubConflictError extends Error {}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function toBase64(content: string): string {
  return Buffer.from(content, "utf8").toString("base64");
}

async function githubRequest(
  config: AppConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
}

async function getTextFile(config: AppConfig, path: string): Promise<GitHubFile | null> {
  const response = await githubRequest(
    config,
    `/repos/${config.githubOwner}/${config.githubRepo}/contents/${encodePath(path)}?ref=${encodeURIComponent(config.githubBranch)}`,
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub read failed for ${path}: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { content: string; sha: string };

  return {
    content: Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8"),
    sha: data.sha,
  };
}

async function putTextFile({
  config,
  path,
  content,
  commitMessage,
  sha,
}: {
  config: AppConfig;
  path: string;
  content: string;
  commitMessage: string;
  sha?: string;
}) {
  const response = await githubRequest(
    config,
    `/repos/${config.githubOwner}/${config.githubRepo}/contents/${encodePath(path)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: commitMessage,
        content: toBase64(content),
        branch: config.githubBranch,
        sha,
      }),
    },
  );

  if (response.status === 409 || response.status === 422) {
    throw new GitHubConflictError(`GitHub write conflict for ${path}`);
  }

  if (!response.ok) {
    throw new Error(`GitHub write failed for ${path}: ${response.status} ${await response.text()}`);
  }
}

export async function updateTextFile(
  config: AppConfig,
  options: {
    path: string;
    commitMessage: string;
    transform: (currentContent: string | null) => string;
  },
): Promise<"created" | "updated" | "unchanged"> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await getTextFile(config, options.path);
    const nextContent = options.transform(existing?.content ?? null);

    if (existing && existing.content === nextContent) {
      return "unchanged";
    }

    try {
      await putTextFile({
        config,
        path: options.path,
        content: nextContent,
        commitMessage: options.commitMessage,
        sha: existing?.sha,
      });

      return existing ? "updated" : "created";
    } catch (error) {
      if (error instanceof GitHubConflictError && attempt === 0) {
        continue;
      }

      throw error;
    }
  }

  return "unchanged";
}

export async function createTextFileIfMissing(
  config: AppConfig,
  options: {
    path: string;
    commitMessage: string;
    content: string;
  },
): Promise<"created" | "exists"> {
  const existing = await getTextFile(config, options.path);

  if (existing) {
    return "exists";
  }

  try {
    await putTextFile({
      config,
      path: options.path,
      content: options.content,
      commitMessage: options.commitMessage,
    });
    return "created";
  } catch (error) {
    if (error instanceof GitHubConflictError) {
      return "exists";
    }

    throw error;
  }
}
