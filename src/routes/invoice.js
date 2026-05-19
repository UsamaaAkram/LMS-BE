const express = require("express");
const router = express.Router();
const invoiceController = require("../controllers/invoiceController");

// Get item catalog (must be before /:id)
router.get("/catalog", invoiceController.getItemCatalog);

// CRUD
router.post("/", invoiceController.createInvoice);
router.get("/", invoiceController.getAllInvoices);
router.get("/:id", invoiceController.getInvoice);
router.put("/:id", invoiceController.updateInvoice);
router.delete("/:id", invoiceController.deleteInvoice);

module.exports = router;