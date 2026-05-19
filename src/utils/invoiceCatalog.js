const INVOICE_ITEMS = [
  {
    itemId: "ITEM_001",
    description: "Tiktok Automation Course Lifetime Access",
    unitPrice: 15000,
  },
  {
    itemId: "ITEM_002",
    description: "YouTube Automation Course Lifetime Access",
    unitPrice: 15000,
  },
  {
    itemId: "ITEM_003",
    description: "Ai Content Creation Course Lifetime Access",
    unitPrice: 15000,
  },
  {
    itemId: "ITEM_004",
    description: "Content Creation Course Lifetime Access",
    unitPrice: 15000,
  },
  {
    itemId: "ITEM_005",
    description: "Advanced Editing Course Lifetime Access",
    unitPrice: 15000,
  },
  {
    itemId: "ITEM_006",
    description: "On-Site Enrollment Charges",
    unitPrice: 10000,
  },
  {
    itemId: "ITEM_007",
    description: "Personal Chat Support Lifetime Access",
    unitPrice: 10000,
  },
  {
    itemId: "ITEM_008",
    description: "Bluverse Creator Bundle Lifetime Access",
    unitPrice: 30000,
  },
];

function getCatalogItem(itemId) {
  return INVOICE_ITEMS.find((item) => item.itemId === itemId) || null;
}

module.exports = { INVOICE_ITEMS, getCatalogItem };