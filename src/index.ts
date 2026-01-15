#!/usr/bin/env node
import { Command } from "commander";
import { createApiClient } from "./api/client";
import { listWebsites } from "./api/hosting";
import { ensureSite, readConfig, writeConfig } from "./config";
import { printWebsites } from "./utils/output";
import { startShell } from "./shell";

const program = new Command();

program
  .name("hostinger")
  .description("Hostinger website management CLI (API + SFTP)")
  .version("0.2.0");

program
  .command("token")
  .description("Manage API token")
  .command("set <token>")
  .description("Save Hostinger API token")
  .action((token: string) => {
    const config = readConfig();
    config.api.token = token;
    writeConfig(config);
    console.log("Token saved.");
  });

program
  .command("domains")
  .description("List websites/domains available to this account")
  .action(async () => {
    const config = readConfig();
    const client = createApiClient(config);
    const websites = await listWebsites(client);
    printWebsites(websites);
  });

program
  .command("connect <domain>")
  .description("Set active site by domain")
  .action(async (domain: string) => {
    const config = readConfig();
    const client = createApiClient(config);
    const websites = await listWebsites(client, domain);
    const match = websites.find((site) => site.domain === domain);

    if (!match) {
      throw new Error(`Domain ${domain} not found in your account.`);
    }

    const site = ensureSite(config, domain);
    site.username = match.username;
    site.orderId = match.order_id;
    if (match.username) {
      site.remoteRoot = `/home/${match.username}/domains/${domain}/public_html`;
    } else {
      site.remoteRoot = site.remoteRoot || "/public_html";
    }
    site.remoteCwd = site.remoteCwd || site.remoteRoot;

    config.activeSite = domain;
    writeConfig(config);

    console.log(`Connected to ${domain}${match.username ? ` (user ${match.username})` : ""}.`);
  });

async function run(): Promise<void> {
  if (process.argv.length <= 2) {
    await startShell();
    return;
  }

  await program.parseAsync(process.argv);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
