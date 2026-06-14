const INVOICE_ITEMS = [
  {
    itemId: "ITEM_001",
    name: "TikTok Automation Course",
    description: "TikTok Automation Course",
    unitPrice: 15000,
  },
  {
    itemId: "ITEM_002",
    name: "YouTube Automation Course",
    description: "YouTube Automation Course",
    unitPrice: 15000,
  },
  {
    itemId: "ITEM_003",
    name: "AI Content Creation Course",
    description: "AI Content Creation Course",
    unitPrice: 15000,
  },
  {
    itemId: "ITEM_004",
    name: "Business Content Mastery Course",
    description: "Business Content Mastery Course",
    unitPrice: 10000,
  },
  {
    itemId: "ITEM_005",
    name: "Advanced Editing Course",
    description: "Advanced Editing Course",
    unitPrice: 15000,
  },
  {
    itemId: "ITEM_006",
    name: "On-Site Enrollment Charges",
    description: "On-Site Enrollment Charges",
    unitPrice: 15000,
  },
  {
    itemId: "ITEM_007",
    name: "On-Site Enrollment Charges",
    description: "On-Site Enrollment Charges",
    unitPrice: 5000,
  },
  {
    itemId: "ITEM_008",
    name: "Lifetime Personal Chat Support",
    description: "Lifetime Personal Chat Support",
    unitPrice: 15000,
  },
];

function getCatalogItem(itemId) {
  return INVOICE_ITEMS.find((item) => item.itemId === itemId) || null;
}

module.exports = { INVOICE_ITEMS, getCatalogItem };