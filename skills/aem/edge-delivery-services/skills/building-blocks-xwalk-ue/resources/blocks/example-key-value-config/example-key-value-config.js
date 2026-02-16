import { readBlockConfig } from "../../scripts/aem.js";

export default async function decorate(block) {
  // Read configuration with readBlockConfig()
  // With key-value: true in JSON, this reads from data-* attributes
  const config = readBlockConfig(block);

  // Extract values with fallbacks for backward compatibility
  const title = config.title || block.dataset.title || "Example Block";
  const subtitle = config.subtitle || block.dataset.subtitle || "";
  const showIcon = (config["show-icon"] || block.dataset.showIcon) === "true";
  const alignment = config.alignment || block.dataset.alignment || "left";
  const maxItems = parseInt(
    config["max-items"] || block.dataset.maxItems || "10",
    10,
  );

  // Clear block content and build new structure
  block.innerHTML = "";

  // Create container with alignment class
  const container = document.createElement("div");
  container.className = `example-config-container align-${alignment}`;

  // Create header with title and optional icon
  const header = document.createElement("div");
  header.className = "example-config-header";

  if (showIcon) {
    const icon = document.createElement("span");
    icon.className = "icon icon-star";
    icon.setAttribute("aria-hidden", "true");
    header.appendChild(icon);
  }

  const heading = document.createElement("h2");
  heading.textContent = title;
  heading.className = "example-config-title";
  header.appendChild(heading);

  if (subtitle) {
    const subtitleElement = document.createElement("p");
    subtitleElement.textContent = subtitle;
    subtitleElement.className = "example-config-subtitle";
    header.appendChild(subtitleElement);
  }

  container.appendChild(header);

  // Create content demonstrating maxItems usage
  const content = document.createElement("div");
  content.className = "example-config-content";
  content.textContent = `This block is configured to show up to ${maxItems} items with ${alignment} alignment.`;
  container.appendChild(content);

  block.appendChild(container);

  // Add data attribute for debugging
  block.dataset.configured = "true";
}
