import PopupTemplate from "@arcgis/core/PopupTemplate.js";

const countFormat = new Intl.NumberFormat("en-US");

export function formatVeteranCount(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return countFormat.format(value);
  }
  if (typeof value === "string" && /^\d{1,20}$/.test(value.trim())) {
    return countFormat.format(BigInt(value.trim()));
  }
  return "Unavailable";
}

export function createVeteranPopupTemplate() {
  return new PopupTemplate({
    title: "Veteran procedures",
    outFields: ["COUNT", "DESCRIPTION", "BIN_ID"],
    lastEditInfoEnabled: false,
    content: ({ graphic }) => {
      const attributes = graphic.attributes ?? {};
      const content = document.createElement("div");
      // Keep custom popup styling with its DOM, including inside SDK shadow roots.
      content.style.cssText = "font-family:var(--calcite-font-family, 'DM Sans', sans-serif);color:#17343c;padding:4px 0 6px;";

      const count = document.createElement("div");
      count.textContent = formatVeteranCount(attributes.COUNT);
      count.style.cssText = "font-family:Manrope, sans-serif;font-size:34px;font-weight:650;line-height:1.25;color:#102b35;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;";

      const label = document.createElement("p");
      label.textContent = "Count";
      label.style.cssText = "font-size:13px;color:#566e6f;margin:5px 0 20px;";

      const descriptionLabel = document.createElement("p");
      descriptionLabel.textContent = "Description";
      descriptionLabel.style.cssText = "font-size:12px;color:#566e6f;margin:0;";
      const description = document.createElement("p");
      description.textContent = typeof attributes.DESCRIPTION === "string" && attributes.DESCRIPTION.trim()
        ? attributes.DESCRIPTION
        : "Unavailable";
      description.style.cssText = "font-size:14px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0 18px;";

      const details = document.createElement("dl");
      details.style.cssText = "display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;border-top:1px solid #dfe6e0;padding-top:13px;margin:0;font-size:12px;";
      const term = document.createElement("dt");
      term.textContent = "Hex ID";
      term.style.color = "#566e6f";
      const bin = document.createElement("dd");
      bin.textContent = typeof attributes.BIN_ID === "string" && attributes.BIN_ID.trim()
        ? attributes.BIN_ID.trim()
        : "Unavailable";
      bin.style.cssText = "margin:0;text-align:right;overflow-wrap:anywhere;font-variant-numeric:tabular-nums;";
      details.append(term, bin);

      content.append(count, label, descriptionLabel, description, details);
      return content;
    },
  });
}
