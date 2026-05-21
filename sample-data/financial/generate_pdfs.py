"""Generate sample receipt and EOB PDFs for testing the financial pipeline.

Receipts go in receipts/, EOBs in eobs/. The Miller family (Sarah=mother,
David=father, Emma & Liam=children) referenced here matches the synthetic
data in frontend/generate-sample-pdfs.jsx, so all the sample inputs tell
one coherent story.

Run from this directory:  python generate_pdfs.py
"""

from __future__ import annotations
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

HERE = Path(__file__).parent
RECEIPTS = HERE / "receipts"
EOBS = HERE / "eobs"
RECEIPTS.mkdir(exist_ok=True)
EOBS.mkdir(exist_ok=True)


def receipt(
    out_name: str,
    *,
    vendor: str,
    address: str,
    phone: str,
    date_str: str,
    time_str: str,
    trans_id: str,
    patient: str | None,
    line_items: list[tuple[str, str, float]],  # (code, desc, amount)
    payment_method: str,
    approval: str,
):
    """Render a simple text receipt PDF — vendor header, line items, total,
    payment method (with card last-4 so the card-lookup resolves payer)."""
    path = RECEIPTS / out_name
    c = canvas.Canvas(str(path), pagesize=letter)
    width, _ = letter
    y = 9.6 * inch

    def line(text, size=10, bold=False, center=False):
        nonlocal y
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        if center:
            c.drawCentredString(width / 2, y, text)
        else:
            c.drawString(1.2 * inch, y, text)
        y -= size + 4

    line(vendor, size=14, bold=True, center=True)
    line(address, center=True)
    line(phone, center=True)
    y -= 8
    line("=" * 60)
    y -= 4
    line(f"DATE: {date_str}   TIME: {time_str}")
    line(f"TRANSACTION: {trans_id}")
    if patient:
        line(f"PATIENT: {patient}")
    y -= 8

    subtotal = 0.0
    for code, desc, amount in line_items:
        text = f"{code:<10}{desc:<35}${amount:7.2f}"
        c.setFont("Courier", 10)
        c.drawString(1.2 * inch, y, text)
        y -= 14
        subtotal += amount

    y -= 6
    c.setFont("Helvetica", 10)
    c.drawString(1.2 * inch, y, f"{'Subtotal':<45}${subtotal:7.2f}")
    y -= 14
    c.drawString(1.2 * inch, y, f"{'Tax':<45}${0.0:7.2f}")
    y -= 14
    c.setFont("Helvetica-Bold", 11)
    c.drawString(1.2 * inch, y, f"{'TOTAL':<45}${subtotal:7.2f}")
    y -= 20
    c.setFont("Helvetica", 10)
    c.drawString(1.2 * inch, y, f"PAID: {payment_method}")
    y -= 14
    c.drawString(1.2 * inch, y, f"Approval: {approval}")
    y -= 14
    c.drawString(1.2 * inch, y, "Signature on file")
    y -= 20
    c.drawCentredString(width / 2, y, "Thank you for your visit!")

    c.save()
    print(f"wrote {path.relative_to(HERE)}")


def eob(
    out_name: str,
    *,
    insurer: str,
    insurer_addr: str,
    member: str,
    member_id: str,
    subscriber: str,
    patient: str,
    date_of_service: str,
    provider: str,
    claim_id: str,
    services: list[tuple[str, str, float, float, float, float]],
    # (code, desc, billed, allowed, plan_paid, pt_resp)
    note: str = "",
):
    """Render an EOB PDF — insurance header, subscriber/patient block,
    service-line table with billed/allowed/insurance paid/patient resp."""
    path = EOBS / out_name
    c = canvas.Canvas(str(path), pagesize=letter)
    width, height = letter
    y = 10.0 * inch

    def text(s, x=1.0 * inch, size=10, bold=False):
        nonlocal y
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(x, y, s)
        y -= size + 4

    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(width / 2, y, insurer)
    y -= 18
    c.setFont("Helvetica", 9)
    c.drawCentredString(width / 2, y, insurer_addr)
    y -= 14
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(width / 2, y, "EXPLANATION OF BENEFITS — THIS IS NOT A BILL")
    y -= 22

    text(f"Member: {member}", size=10)
    text(f"Member ID: {member_id}", size=10)
    text(f"Subscriber / Policyholder: {subscriber}", size=10, bold=True)
    text(f"Patient: {patient}", size=10, bold=True)
    text(f"Date of Service: {date_of_service}", size=10)
    text(f"Provider: {provider}", size=10)
    text(f"Claim #: {claim_id}", size=10)
    y -= 6

    # Service table — fixed-width font for column alignment.
    c.setFont("Helvetica-Bold", 9)
    header = f"{'CODE':<10}{'SERVICE':<32}{'BILLED':>10}{'ALLOWED':>10}{'PLAN PAID':>12}{'PT RESP':>10}"
    c.setFont("Courier-Bold", 8)
    c.drawString(0.6 * inch, y, header)
    y -= 12
    c.setStrokeColorRGB(0.6, 0.6, 0.6)
    c.line(0.6 * inch, y + 4, 8.0 * inch, y + 4)

    totals = [0.0, 0.0, 0.0, 0.0]
    c.setFont("Courier", 8)
    for code, desc, billed, allowed, plan_paid, pt_resp in services:
        row = (
            f"{code:<10}{desc:<32}{billed:>9.2f} {allowed:>9.2f} "
            f"{plan_paid:>11.2f} {pt_resp:>9.2f}"
        )
        c.drawString(0.6 * inch, y, row)
        y -= 11
        totals = [
            totals[0] + billed, totals[1] + allowed,
            totals[2] + plan_paid, totals[3] + pt_resp,
        ]

    c.line(0.6 * inch, y + 3, 8.0 * inch, y + 3)
    y -= 6
    c.setFont("Courier-Bold", 8)
    c.drawString(
        0.6 * inch, y,
        f"{'TOTALS':<42}{totals[0]:>9.2f} {totals[1]:>9.2f} "
        f"{totals[2]:>11.2f} {totals[3]:>9.2f}",
    )
    y -= 22
    c.setFont("Helvetica-Bold", 11)
    c.drawString(1.0 * inch, y, f"Patient responsibility: ${totals[3]:.2f}")
    y -= 18
    c.setFont("Helvetica", 9)
    c.drawString(
        1.0 * inch, y,
        "This is your portion after insurance. The provider may bill you for "
        "this amount.",
    )
    if note:
        y -= 14
        c.drawString(1.0 * inch, y, note)

    c.save()
    print(f"wrote {path.relative_to(HERE)}")


# --- Receipts -----------------------------------------------------------------

receipt(
    "pediatric-dental-emma-2024-03-15.pdf",
    vendor="PEDIATRIC DENTAL OF WV",
    address="1200 Lee Street East, Charleston, WV 25301",
    phone="(304) 555-1208",
    date_str="03/15/2024", time_str="10:42 AM",
    trans_id="8847352",
    patient="Emma Miller",
    line_items=[
        ("D1110", "Adult prophylaxis", 98.00),
        ("D0274", "Bitewings (four films)", 62.00),
        ("D0220", "Periapical (one film)", 20.00),
    ],
    payment_method="VISA ****4521",
    approval="042298",
)

receipt(
    "mountainview-eye-liam-2024-09-30.pdf",
    vendor="MOUNTAINVIEW EYE CENTER",
    address="845 Capitol Street, Charleston, WV 25301",
    phone="(304) 555-3409",
    date_str="09/30/2024", time_str="2:15 PM",
    trans_id="EYE-22198",
    patient="Liam Miller",
    line_items=[
        ("92002", "Comprehensive eye exam", 95.00),
        ("V2020", "Frames (children's)", 35.00),
        ("V2200", "Polycarbonate lenses (pair)", 15.00),
    ],
    payment_method="VISA ****4521",
    approval="118840",
)

receipt(
    "camp-mountain-pines-deposit-2024-04-22.pdf",
    vendor="CAMP MOUNTAIN PINES",
    address="2200 Snowshoe Drive, Slatyfork, WV 26291",
    phone="(304) 555-7700",
    date_str="04/22/2024", time_str="9:30 AM",
    trans_id="REG-2024-EMMILLER",
    patient="Emma Miller — Session A (June 15-22)",
    line_items=[
        ("DEP", "Camp registration deposit", 250.00),
    ],
    payment_method="VISA ****4521",
    approval="ON-7821",
)

receipt(
    "charleston-soccer-fall-2024-08-10.pdf",
    vendor="CHARLESTON SOCCER CLUB",
    address="4800 MacCorkle Avenue SW, South Charleston, WV 25309",
    phone="(304) 555-6612",
    date_str="08/10/2024", time_str="11:05 AM",
    trans_id="REG-FALL-2024-3318",
    patient="Liam Miller — U10 Boys",
    line_items=[
        ("FEE", "Fall season registration", 125.00),
        ("UNI", "Uniform set", 35.00),
        ("REF", "Referee fees", 15.00),
    ],
    payment_method="VISA ****4521",
    approval="091227",
)

receipt(
    "target-school-supplies-2024-08-05.pdf",
    vendor="TARGET T-2104",
    address="3400 MacCorkle Avenue SE, Charleston, WV 25304",
    phone="(304) 555-1100",
    date_str="08/05/2024", time_str="6:48 PM",
    trans_id="A09142-2104",
    patient=None,
    line_items=[
        ("SUP", "Backpacks (2) — Emma & Liam", 64.00),
        ("SUP", "Notebooks, binders, paper", 28.40),
        ("SUP", "Pens, pencils, markers", 19.30),
        ("SUP", "Lunch boxes (2)", 16.72),
    ],
    payment_method="VISA ****4521",
    approval="558190",
)

receipt(
    "driving-academy-emma-2024-06-12.pdf",
    vendor="DRIVING ACADEMY OF WV",
    address="120 Quarrier Street, Charleston, WV 25301",
    phone="(304) 555-4422",
    date_str="06/12/2024", time_str="4:00 PM",
    trans_id="DA-2024-EMILLER-02",
    patient="Emma Miller (learner's permit)",
    line_items=[
        ("LSN", "Behind-the-wheel lesson #2 (90 min)", 90.00),
        ("LSN", "Behind-the-wheel lesson #3 (90 min)", 90.00),
    ],
    payment_method="VISA ****4521",
    approval="022281",
)

receipt(
    "mountain-state-orthodontics-2024-03-15.pdf",
    vendor="MOUNTAIN STATE ORTHODONTICS",
    address="3200 Kanawha Boulevard E, Charleston, WV 25311",
    phone="(304) 555-2901",
    date_str="03/15/2024", time_str="3:30 PM",
    trans_id="MSO-2024-9941",
    patient="Emma Miller",
    line_items=[
        ("D8090", "Comprehensive orthodontic treatment — payment 3 of 18", 225.00),
    ],
    payment_method="VISA ****4521",
    approval="334872",
)

# --- EOBs --------------------------------------------------------------------

eob(
    "bluecross-eob-emma-dental-2024-03.pdf",
    insurer="BLUECROSS BLUESHIELD OF WEST VIRGINIA",
    insurer_addr="P.O. Box 1948, Charleston, WV 25327 · (304) 555-0011",
    member="Sarah J Miller",
    member_id="WBC-2241-4421",
    subscriber="Sarah J Miller (POLICYHOLDER)",
    patient="Emma Miller (Dependent, DOB 03/08/2009)",
    date_of_service="03/15/2024",
    provider="Pediatric Dental of WV — Charleston",
    claim_id="20240315-DENT-9942",
    services=[
        ("D1110", "Adult prophylaxis", 98.00, 73.50, 58.80, 14.70),
        ("D0274", "Bitewings (four films)", 62.00, 46.50, 37.20, 9.30),
        ("D0220", "Periapical (one film)", 20.00, 15.00, 12.00, 3.00),
    ],
    note="Plan year deductible: $750.00 met. Coinsurance: 80% / 20%.",
)

eob(
    "aetna-eob-liam-pediatric-2024-08.pdf",
    insurer="AETNA",
    insurer_addr="151 Farmington Avenue, Hartford, CT 06156 · (800) 555-2255",
    member="Sarah J Miller",
    member_id="W333128840",
    subscriber="Sarah J Miller (POLICYHOLDER)",
    patient="Liam Miller (Dependent, DOB 11/22/2014)",
    date_of_service="08/18/2024",
    provider="Charleston Family Medicine — Dr. R. Patel",
    claim_id="A-2024-118840-LIM",
    services=[
        ("99213", "Office visit, est. patient (15 min)", 165.00, 110.00, 85.00, 25.00),
        ("86618", "Borrelia burgdorferi (Lyme) antibody", 142.00, 78.00, 62.40, 15.60),
        ("87880", "Streptococcus group A direct test", 48.00, 26.00, 20.80, 5.20),
    ],
    note="In-network. Patient responsibility includes $25 office copay.",
)

eob(
    "united-eob-emma-orthodontic-2024-05.pdf",
    insurer="UNITEDHEALTHCARE",
    insurer_addr="P.O. Box 30555, Salt Lake City, UT 84130 · (866) 555-1188",
    member="David A Miller",
    member_id="UHC-948-2241",
    subscriber="David A Miller (POLICYHOLDER — father)",
    patient="Emma Miller (Dependent, DOB 03/08/2009)",
    date_of_service="05/14/2024",
    provider="Mountain State Orthodontics — Charleston",
    claim_id="UHC-20240514-2218",
    services=[
        ("D8090", "Comprehensive orthodontic tx (monthly installment)", 350.00, 280.00, 180.00, 100.00),
        ("D8670", "Periodic orthodontic visit", 65.00, 52.00, 33.00, 19.00),
    ],
    note=(
        "Subscriber is the father — his plan covers Emma as a dependent. "
        "Patient responsibility was billed to the subscriber's account."
    ),
)

print("done.")
