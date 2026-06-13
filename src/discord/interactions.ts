import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
} from "discord.js";
import { backend } from "../backend.ts";
import { agentSelection, approvalStore } from "../store.ts";
import { logger } from "../logger.ts";
import { decisionEmbed } from "./embeds.ts";

/**
 * Handles button clicks. customId formats:
 *   - "agent:<id>"            — pick the agent to use for /objectif
 *   - "approve:<approvalId>"  — human-in-the-loop validation
 *   - "reject:<approvalId>"
 */
export async function handleButton(interaction: ButtonInteraction) {
  const sep = interaction.customId.indexOf(":");
  const action = sep >= 0 ? interaction.customId.slice(0, sep) : interaction.customId;
  const value = sep >= 0 ? interaction.customId.slice(sep + 1) : "";

  if (action === "agent") return handleAgentPick(interaction, value);
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

/** Store the picked agent for this user (name read from the clicked button). */
async function handleAgentPick(interaction: ButtonInteraction, agentId: string) {
  if (!agentId) return;
  const comp = interaction.component;
  const name = ("label" in comp && comp.label) || agentId;
  agentSelection.set(interaction.user.id, { id: agentId, name });
  logger.info("Agent selected", { agentId, by: interaction.user.tag });
  await interaction.reply({
    content: `✅ Agent sélectionné : **${name}**.\nLance maintenant \`/objectif\` avec ce que tu veux faire.`,
    ephemeral: true,
  });
}
