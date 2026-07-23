const express = require("express");
const router = express.Router();
const invoiceController = require("../controllers/invoiceController");
const jwtAuth = require("../middleware/jwtAuth");
const requireRole = require("../middleware/requireRole");

// Invoices / receipts / plans hold billing data. Every route here requires a
// valid JWT AND an admin/instructor role — students (and anonymous callers)
// get 403 and never see invoice, receipt, or plan data via the API.
router.use(jwtAuth, requireRole("admin", "instructor"));

// Get item catalog (must be before /:id)
router.get("/catalog", invoiceController.getItemCatalog);

// CRUD
router.post("/", invoiceController.createInvoice);
router.get("/", invoiceController.getAllInvoices);
router.get("/:id", invoiceController.getInvoice);
router.put("/:id", invoiceController.updateInvoice);
router.post("/:id/regenerate-pdf", invoiceController.regenerateInvoicePdf);
router.post("/:id/restore", invoiceController.restoreInvoice);
router.delete("/:id", invoiceController.deleteInvoice);

module.exports = router;