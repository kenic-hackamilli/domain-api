const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

// Clean domain input
function cleanDomain(name) {
  return name.trim().toLowerCase();
}

// Compute user-friendly status
function computeStatus(row) {
  if (row.st_pendingdelete) return "Pending Delete";
  if (row.st_cl_hold || row.st_sv_hold) return "On Hold";
  if (row.st_pendingtransfer) return "Pending Transfer";
  if (row.st_pendingrenew) return "Pending Renew";
  if (row.st_pendingupdate) return "Pending Update";
  if (row.st_pendingcreate) return "Pending Creation";
  if (row.st_inactive) return "Inactive";
  if (row.st_ok) return "Active";

  return "Status Restricted";
}

app.get("/check-domain", async (req, res) => {
  const { name } = req.query;
  if (!name) {
    return res.status(400).json({ error: "Domain name required" });
  }

  const cleanName = cleanDomain(name);

  try {
    const query = `
      SELECT
        d.name,
        d.exdate,
        d.renewaldate,
        d.registrant,

        -- Registrar mapping
        d.clid AS registrar_id,
        c.name AS registrar_name,

        -- Status fields
        d.st_ok,
        d.st_pendingdelete,
        d.st_pendingtransfer,
        d.st_pendingrenew,
        d.st_pendingupdate,
        d.st_pendingcreate,
        d.st_inactive,
        d.st_cl_hold,
        d.st_sv_hold,
        d.st_cl_deleteprohibited,
        d.st_cl_renewprohibited,
        d.st_cl_transferprohibited,
        d.st_cl_updateprohibited,
        d.st_sv_deleteprohibited,
        d.st_sv_renewprohibited,
        d.st_sv_transferprohibited,
        d.st_sv_updateprohibited,

        d.createdate,
        d.updatedate,
        d.signed

      FROM domain d
      LEFT JOIN client c ON d.clid = c.clid
      WHERE d.name = $1
      LIMIT 1;
    `;

    const result = await pool.query(query, [cleanName]);

    if (result.rows.length === 0) {
      return res.json({ exists: false });
    }

    const row = result.rows[0];

    // Compute readable status
    const status = computeStatus(row);

    // Group status sub-sections
    const pending = {
      delete: !!row.st_pendingdelete,
      transfer: !!row.st_pendingtransfer,
      renew: !!row.st_pendingrenew,
      update: !!row.st_pendingupdate,
      create: !!row.st_pendingcreate
    };

    const prohibited = {
      client: {
        delete: !!row.st_cl_deleteprohibited,
        renew: !!row.st_cl_renewprohibited,
        transfer: !!row.st_cl_transferprohibited,
        update: !!row.st_cl_updateprohibited
      },
      server: {
        delete: !!row.st_sv_deleteprohibited,
        renew: !!row.st_sv_renewprohibited,
        transfer: !!row.st_sv_transferprohibited,
        update: !!row.st_sv_updateprohibited
      }
    };

    // Return final JSON response
    res.json({
      exists: true,
      name: row.name,
      registrar_id: row.registrar_id,
      registrar_name: row.registrar_name,
      registrant: row.registrant,
      status,
      expiry: row.exdate,
      renewal: row.renewaldate,
      pending,
      prohibited,
      created: row.createdate,
      updated: row.updatedate,
      signed: row.signed
    });

  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({ error: "Database query failed" });
  }
});

// Start API
const PORT = 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
