---
name: PO Processing
description: Logic and validation rules for PO Parser AI extraction.
---
# PO Processing Skill

## Objectives
- Extract data from PDF Purchase Orders accurately.
- Validate EAN/Article numbers against the Item Master.
- Standardize enterprise schema mapping (12-column schema).

## Instructions
1. **Extraction**:
   - Use Gemini-based extraction logic as defined in the `BACKEND` controllers.
   - Target fields: PO Number, Date, EAN, Quantity, Rate, Amount, etc.
2. **Validation**:
   - Perform fuzzy header matching for non-standard Excel uploads.
   - Cross-reference Article Numbers with the database to ensure SKU accuracy.

## Reference Paths
- Controllers: `s:\JMS_Enterprise\BACKEND\controllers\POController.js`
- Schema: Refer to the Enterprise V2 Item Master schema.
