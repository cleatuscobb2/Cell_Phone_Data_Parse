/**
 * CustodyReportPDFLandscape — the landscape-oriented variant of the custody
 * report. It renders the same content as the portrait CustodyReportPDF; the
 * wider page gives the timeline and message log more horizontal room, which
 * can read more comfortably. Offered as a separate report so the two layouts
 * can be generated side by side and compared.
 */

import CustodyReportPDF from "./CustodyReportPDF.jsx";

export default function CustodyReportPDFLandscape({ data }) {
  return <CustodyReportPDF data={data} orientation="landscape" />;
}
