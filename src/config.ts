import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const mappingSchema = z.object({
  discordChannelId: z.string().min(1),
  discordWebhookUrl: z.string().url(),
  matrixRoomId: z.string().min(1),
});

const configSchema = z.object({
  discord: z.object({
    botToken: z.string().min(1),
  }),
  matrix: z.object({
    homeserverUrl: z.string().url(),
    accessToken: z.string().min(1),
    botUserId: z.string().min(1).optional(),
  }),
  bridge: z.object({
    statePath: z.string().default("./data/state.json"),
    matrixSyncPath: z.string().default("./data/matrix-sync.json"),
    forwardReactions: z.boolean().default(true),
    forwardEdits: z.boolean().default(true),
    mappings: z.array(mappingSchema).min(1),
  }),
});

export type BridgeConfig = z.infer<typeof configSchema>;
export type BridgeMapping = z.infer<typeof mappingSchema>;

export async function loadConfig(): Promise<BridgeConfig> {
  const configPath = process.env.CONFIG_PATH ?? "./config.json";
  const absolutePath = path.resolve(configPath);

  const raw = await fs.readFile(absolutePath, "utf8");
  const json = JSON.parse(raw) as unknown;
  return configSchema.parse(json);
}
