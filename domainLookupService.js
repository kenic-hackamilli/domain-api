class DomainLookupError extends Error {
  constructor({ code, message, statusCode, details }) {
    super(message);
    this.name = "DomainLookupError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

const digitsOnly = (value) =>
  typeof value === "string" ? value.replace(/\D/g, "") : "";

const normalizeKenyanPhone = (value) => {
  const digits = digitsOnly(value);
  if (!digits) return "";

  if (digits.startsWith("254") && digits.length >= 12) {
    return digits;
  }

  if (digits.startsWith("0") && digits.length === 10) {
    return `254${digits.slice(1)}`;
  }

  if (digits.length === 9) {
    return `254${digits}`;
  }

  return digits;
};

const buildPhoneCandidates = (value) => {
  const normalized = normalizeKenyanPhone(value);
  const candidates = new Set();

  if (!normalized) {
    return [];
  }

  candidates.add(normalized);

  if (normalized.startsWith("254") && normalized.length === 12) {
    candidates.add(`0${normalized.slice(3)}`);
    candidates.add(normalized.slice(3));
  }

  const digits = digitsOnly(value);
  if (digits) {
    candidates.add(digits);
  }

  return [...candidates].filter(Boolean);
};

const resolveLookupPhone = ({ profile, claims }) => {
  const profilePhone =
    profile?.phone || profile?.phoneNumber || claims?.phone_number || "";
  const normalized = normalizeKenyanPhone(profilePhone);

  if (!normalized) {
    throw new DomainLookupError({
      code: "PROFILE_PHONE_MISSING",
      message: "Add a phone number to your profile to view registered domains.",
      statusCode: 400,
    });
  }

  return {
    displayPhone: String(profilePhone).trim() || normalized,
    candidates: buildPhoneCandidates(normalized),
  };
};

const computeStatus = (row) => {
  if (row.st_pendingdelete) return "Pending Delete";
  if (row.st_cl_hold || row.st_sv_hold) return "On Hold";
  if (row.st_pendingtransfer) return "Pending Transfer";
  if (row.st_pendingrenew) return "Pending Renew";
  if (row.st_pendingupdate) return "Pending Update";
  if (row.st_pendingcreate) return "Pending Creation";
  if (row.st_inactive) return "Inactive";
  if (row.st_ok) return "Active";

  return "Unknown";
};

const normalizeExpiry = (value) => {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

const lookupDomainsForAuthenticatedUser = async ({ pool, profile, claims }) => {
  const { displayPhone, candidates } = resolveLookupPhone({ profile, claims });

  if (candidates.length === 0) {
    throw new DomainLookupError({
      code: "PROFILE_PHONE_INVALID",
      message:
        "We couldn't use the phone number on your profile. Update it and try again.",
      statusCode: 400,
    });
  }

  const query = `
    SELECT
      dc.contact_id,
      dc.domain_name AS domain_name,
      c.voice AS contact_phone,
      d.exdate,
      client.name AS registrar_name,
      d.st_ok,
      d.st_pendingdelete,
      d.st_pendingtransfer,
      d.st_pendingrenew,
      d.st_pendingupdate,
      d.st_pendingcreate,
      d.st_inactive,
      d.st_cl_hold,
      d.st_sv_hold
    FROM contact c
    JOIN domain_contact dc
      ON dc.contact_id = c.id
     AND dc.type = 'registrant'
    LEFT JOIN domain d
      ON d.name = dc.domain_name
    LEFT JOIN client
      ON d.clid = client.clid
    WHERE regexp_replace(COALESCE(c.voice, ''), '[^0-9]+', '', 'g') = ANY($1::text[])
    ORDER BY dc.domain_name;
  `;

  const { rows } = await pool.query(query, [candidates]);
  const domainMap = new Map();

  rows.forEach((row) => {
    const domain = typeof row.domain_name === "string" ? row.domain_name.trim() : "";
    if (!domain || domainMap.has(domain)) {
      return;
    }

    domainMap.set(domain, {
      domain,
      registrar_name:
        typeof row.registrar_name === "string" && row.registrar_name.trim()
          ? row.registrar_name.trim()
          : "Unknown Registrar",
      expiry: normalizeExpiry(row.exdate),
      status: computeStatus(row),
    });
  });

  return {
    phone: displayPhone,
    domains: [...domainMap.values()],
  };
};

module.exports = {
  DomainLookupError,
  lookupDomainsForAuthenticatedUser,
};
