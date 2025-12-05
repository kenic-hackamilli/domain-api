const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

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
  // Locked/Prohibited can be shown as info, not primary status
  return "Status Restricted";
}

app.get("/check-domain", async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "Domain name required" });

  const cleanName = cleanDomain(name);

  try {
    const query = `
      SELECT
        name,
        exdate,
        renewaldate,
        registrant,
        clid AS registrar_id,
        st_ok,
        st_pendingdelete,
        st_pendingtransfer,
        st_pendingrenew,
        st_pendingupdate,
        st_pendingcreate,
        st_inactive,
        st_cl_hold,
        st_sv_hold,
        st_cl_deleteprohibited,
        st_cl_renewprohibited,
        st_cl_transferprohibited,
        st_cl_updateprohibited,
        st_sv_deleteprohibited,
        st_sv_renewprohibited,
        st_sv_transferprohibited,
        st_sv_updateprohibited,
        createdate,
        updatedate,
        signed
      FROM domain
      WHERE name = $1
      LIMIT 1
    `;

    const result = await pool.query(query, [cleanName]);
    if (result.rows.length === 0) return res.json({ exists: false });

    const row = result.rows[0];
    const status = computeStatus(row);

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

    res.json({
      exists: true,
      name: row.name,
      status,
      expiry: row.exdate,
      renewal: row.renewaldate,
      pending,
      prohibited,
      registrar_id: row.registrar_id,
      registrant: row.registrant,
      created: row.createdate,
      updated: row.updatedate,
      signed: row.signed
    });
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({ error: "Database query failed" });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
