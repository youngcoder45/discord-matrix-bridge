import fs from "node:fs/promises";
import path from "node:path";

export type MatrixReactionToDiscord = {
  discordMessageId: string;
  emoji: string;
};

export type BridgeState = {
  discordToMatrix: Record<string, string>;
  matrixToDiscord: Record<string, string>;
  discordReactionToMatrix: Record<string, string>; // key -> matrix reaction eventId
  matrixReactionToDiscord: Record<string, MatrixReactionToDiscord>; // matrix reaction eventId -> info
};

const DEFAULT_STATE: BridgeState = {
  discordToMatrix: {},
  matrixToDiscord: {},
  discordReactionToMatrix: {},
  matrixReactionToDiscord: {},
};

export class StateStore {
  private state: BridgeState = structuredClone(DEFAULT_STATE);
  private saveChain: Promise<void> = Promise.resolve();

  public constructor(private readonly filePath: string) {}

  public get snapshot(): BridgeState {
    return this.state;
  }

  public async load(): Promise<void> {
    const absolutePath = path.resolve(this.filePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    try {
      const raw = await fs.readFile(absolutePath, "utf8");
      const json = JSON.parse(raw) as Partial<BridgeState>;
      this.state = {
        discordToMatrix: json.discordToMatrix ?? {},
        matrixToDiscord: json.matrixToDiscord ?? {},
        discordReactionToMatrix: json.discordReactionToMatrix ?? {},
        matrixReactionToDiscord: json.matrixReactionToDiscord ?? {},
      };
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        this.state = structuredClone(DEFAULT_STATE);
        await this.save();
        return;
      }
      throw err;
    }
  }

  public async save(): Promise<void> {
    this.saveChain = this.saveChain.then(async () => {
      const absolutePath = path.resolve(this.filePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      const tmpPath = `${absolutePath}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(this.state, null, 2), "utf8");
      await fs.rename(tmpPath, absolutePath);
    });

    return this.saveChain;
  }

  public async setDiscordMatrixMessage(discordMessageId: string, matrixEventId: string): Promise<void> {
    this.state.discordToMatrix[discordMessageId] = matrixEventId;
    this.state.matrixToDiscord[matrixEventId] = discordMessageId;
    await this.save();
  }

  public getMatrixEventIdForDiscordMessage(discordMessageId: string): string | undefined {
    return this.state.discordToMatrix[discordMessageId];
  }

  public getDiscordMessageIdForMatrixEvent(matrixEventId: string): string | undefined {
    return this.state.matrixToDiscord[matrixEventId];
  }

  public async setDiscordReactionMatrixEvent(key: string, matrixReactionEventId: string): Promise<void> {
    this.state.discordReactionToMatrix[key] = matrixReactionEventId;
    await this.save();
  }

  public getMatrixReactionEventIdForDiscordReaction(key: string): string | undefined {
    return this.state.discordReactionToMatrix[key];
  }

  public async deleteDiscordReaction(key: string): Promise<void> {
    delete this.state.discordReactionToMatrix[key];
    await this.save();
  }

  public async setMatrixReactionDiscordInfo(matrixReactionEventId: string, info: MatrixReactionToDiscord): Promise<void> {
    this.state.matrixReactionToDiscord[matrixReactionEventId] = info;
    await this.save();
  }

  public getDiscordInfoForMatrixReaction(matrixReactionEventId: string): MatrixReactionToDiscord | undefined {
    return this.state.matrixReactionToDiscord[matrixReactionEventId];
  }

  public async deleteMatrixReaction(matrixReactionEventId: string): Promise<void> {
    delete this.state.matrixReactionToDiscord[matrixReactionEventId];
    await this.save();
  }
}
