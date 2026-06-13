import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
} from "discord.js";
import { backend } from "../backend.ts";
import { approvalStore, pendingObjective, store } from "../store.ts";
import { logger } from "../logger.ts";
import { subscribeJob } from "../jobstream.ts";
import { decisionEmbed, jobEmbed } from "./embeds.ts";

/**
 * Handles button clicks. customId formats:
 *   - "launch:<agentId>"      — launch the pending /objectif with this agent
 *   - "approve:<approvalId>"  — human-in-the-loop validation
 *   - "reject:<approvalId>"
 */
export async function handleButton(interaction: ButtonInteraction) {
  const sep = interaction.customId.indexOf(":");
  const action = sep >= 0 ? interaction.customId.slice(0, sep) : interaction.customId;
  const value = sep >= 0 ? interaction.customId.slice(sep + 1) : "";
  logger.info("Button clicked", { action, value, user: interaction.user.tag });

  if (action === "launch") return handleLaunch(interaction, value);
  if ((action !== "approve" && action !== "reject") || !value) return;
  const approvalId = value;

  const req = approvalStore.take(approvalId);
  if (!req) {
    await interaction.reply({
      content: "Cette demande a déjà été traitée (ou a expiré).",
      ephemeral: true,
    });
    return;
  }

  const approved = action === "approve";
  const by = interaction.user.tag ?? interaction.user.username;

  // Acknowledge immediately so buttons feel responsive, then call backend.
  await interaction.deferUpdate();

  const res = await backend.sendApproval(approvalId, {
    decision: approved ? "approve" : "reject",
  });

  if (!res.ok) {
    // Put the request back so the user can retry, and surface the error.
    approvalStore.add(req);
    await interaction.followUp({
      content: `⚠️ Échec de l'envoi de la décision au backend : ${res.error}. Réessaie.`,
      ephemeral: true,
    });
    return;
  }

  // Replace the message: decision recap + disabled buttons (rebuilt fresh).
  const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve:${approvalId}`)
      .setLabel("Valider")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`reject:${approvalId}`)
      .setLabel("Refuser")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true),
  );

  await interaction.editReply({
    embeds: [decisionEmbed(req, approved, by)],
    components: [disabledRow],
  });

  logger.info("Approval decided", { approvalId, jobId: req.jobId, approved, by });
}

/**
 * Launch the user's pending objective with the clicked agent. The clicked
 * message (the /objectif reply) becomes the live timeline embed.
 */
async function handleLaunch(interaction: ButtonInteraction, agentId: string) {
  if (!agentId) return;
  const comp = interaction.component;
  const name = ("label" in comp && comp.label) || agentId;

  const pending = pendingObjective.take(interaction.user.id);
  if (!pending) {
    await interaction.reply({
      content: "⚠️ Aucun objectif en attente (session expirée). Relance `/objectif`.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  const res = await backend.createObjective({
    agent_id: agentId,
    title: pending.text.slice(0, 80),
    prompt: pending.text,
  });
  if (!res.ok) {
    await interaction.editReply({
      content: `⚠️ Impossible de lancer l'objectif : ${res.error}.`,
      components: [],
    });
    return;
  }

  const jobId = res.data.job_id;
  // Reuse THIS message (the /objectif reply) as the living timeline.
  const job = store.create(jobId, pending.text, pending.channelId, interaction.message.id);
  await interaction.editReply({
    content: `🚀 Lancé avec l'agent **${name}**`,
    embeds: [jobEmbed(job)],
    components: [],
  });

  subscribeJob(interaction.client, jobId);
  logger.info("Objective launched", { jobId, agentId, by: interaction.user.tag });
}
