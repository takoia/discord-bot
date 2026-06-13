import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
} from "discord.js";
import { backend } from "../backend.ts";
import { approvalStore } from "../store.ts";
import { logger } from "../logger.ts";
import { decisionEmbed } from "./embeds.ts";

/**
 * Handles ✅/❌ button clicks on approval messages.
 * customId format: "approve:<approvalId>" | "reject:<approvalId>".
 */
export async function handleButton(interaction: ButtonInteraction) {
  const [action, approvalId] = interaction.customId.split(":");
  if ((action !== "approve" && action !== "reject") || !approvalId) return;

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
    by,
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
