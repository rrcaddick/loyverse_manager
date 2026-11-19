"""Quote/signature splitter fixtures shaped like real traffic in the park's
mailbox: Gmail, Outlook (web and desktop), Apple Mail, Samsung/plain text,
Afrikaans, forwards, and mail with nothing to split. No DB, no network."""

from __future__ import annotations

import pytest

from src.services import quote_split as qs

# ----------------------------------------------------------------- fixtures ---

GMAIL_HTML = (
    '<div dir="ltr">Hi Linda<div><br></div><div>Thank you, please book the 4th of December for us. '
    'We will be 45 learners and 4 teachers.</div><div><br></div><div>Kind regards,</div>'
    '<div>Nolene</div><div>Grade 3 teacher</div></div><br>'
    '<div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">On Thu, 8 Oct 2026 at 11:00, '
    'Farmyard Park &lt;<a href="mailto:thefarmyardpark@gmail.com">thefarmyardpark@gmail.com</a>&gt; wrote:<br></div>'
    '<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">'
    '<div dir="ltr">Hi Nolene,<div><br></div><div>Thank you for considering the Farmyard for your outing.</div>'
    '<div>The 4th is available.</div><div><br></div><div>Kind regards,</div><div>Linda</div></div></blockquote></div>'
)
GMAIL_TEXT = (
    "Hi Linda\r\n\r\nThank you, please book the 4th of December for us. We will be 45 learners and 4 teachers.\r\n\r\n"
    "Kind regards,\r\nNolene\r\nGrade 3 teacher\r\n\r\n"
    "On Thu, 8 Oct 2026 at 11:00, Farmyard Park <thefarmyardpark@gmail.com>\r\nwrote:\r\n\r\n"
    "> Hi Nolene,\r\n>\r\n> Thank you for considering the Farmyard for your outing.\r\n> The 4th is available.\r\n>\r\n"
    "> Kind regards,\r\n> Linda\r\n"
)

OUTLOOK_HTML = (
    '<div style="font-family:Aptos,sans-serif;font-size:12pt;color:rgb(0,0,0)">Hi Linda,</div>'
    '<div style="font-family:Aptos,sans-serif;font-size:12pt;color:rgb(0,0,0)"><br></div>'
    '<div style="font-family:Aptos,sans-serif;font-size:12pt;color:rgb(0,0,0)">Thank you that will be much appreciated.</div>'
    '<div style="font-family:Aptos,sans-serif;font-size:12pt;color:rgb(0,0,0)"><br></div>'
    '<div style="font-family:Aptos,sans-serif;font-size:12pt;color:rgb(0,0,0)">Regards</div>'
    '<div style="font-family:Aptos,sans-serif;font-size:12pt;color:rgb(0,0,0)">Nicole</div>'
    '<div id="appendonsend"></div><hr style="display:inline-block;width:98%">'
    '<div id="divRplyFwdMsg" dir="ltr"><font face="Calibri, sans-serif" style="font-size:11pt" color="#000000">'
    '<b>From:</b> Farmyard Park &lt;thefarmyardpark@gmail.com&gt;<br><b>Sent:</b> Wednesday, 07 October 2026 09:49<br>'
    '<b>To:</b> PERSEVERANCE PRIMARY SCHOOL &lt;school@example.gov.za&gt;<br><b>Subject:</b> Re: Availability</font>'
    '<div> </div></div><div><div dir="ltr">Hi Nicole<div><br></div><div>Yes, the 14th is open.</div></div></div>'
)
OUTLOOK_TEXT = (
    "Hi Linda,\r\n\r\nThank you that will be much appreciated.\r\n\r\nRegards\r\n\r\nNicole\r\n"
    "________________________________\r\nFrom: Farmyard Park <thefarmyardpark@gmail.com>\r\n"
    "Sent: Wednesday, 07 October 2026 09:49\r\nTo: PERSEVERANCE PRIMARY SCHOOL <school@example.gov.za>\r\n"
    "Subject: Re: Availability\r\n\r\nHi Nicole\r\n\r\nYes, the 14th is open.\r\n"
)

APPLE_HTML = (
    '<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"></head>'
    '<body style="overflow-wrap: break-word;">Hi Linda, hope you are well.<div>Would you be so kind to book the '
    'date for me please, would the 04/12/26.</div><div><br></div><div>Nolene</div><div><br></div>'
    '<div>Sent from my iPhone</div><div><br><blockquote type="cite"><div>On 08 Oct 2026, at 11:00, Farmyard Park '
    '&lt;thefarmyardpark@gmail.com&gt; wrote:</div><br class="Apple-interchange-newline"><div><div dir="ltr">'
    'Hi Nolene,<div>Thank you for considering the Farmyard.</div></div></div></blockquote></div></body></html>'
)
APPLE_TEXT = (
    "Hi Linda, hope you are well.\nWould you be so kind to book the date for me please, would the 04/12/26.\n\n"
    "Nolene\n\nSent from my iPhone\n\n> On 08 Oct 2026, at 11:00, Farmyard Park <thefarmyardpark@gmail.com> wrote:\n> \n"
    "> ﻿\n> Hi Nolene,\n> Thank you for considering the Farmyard.\n"
)

PLAIN_TEXT = (
    "Good day\n\nWe are a church group of about 60 adults and would like to visit on 28 November.\n"
    "Please send me a quote.\n\nThanks\nThembakazi\n082 123 4567\n\nSent from my Galaxy\n\n\n"
    "-------- Original message --------\nFrom: Farmyard Park <thefarmyardpark@gmail.com>\n"
    "Date: 2026/10/08 10:31 (GMT+02:00)\nTo: tembi@example.com\nSubject: Re: Booking\n\nHi Thembakazi\n\nThank you for your enquiry.\n"
)

AFRIKAANS_HTML = (
    '<div dir="ltr">Goeie dag Linda<div><br></div><div>Ons wil graag die 20ste bespreek vir 50 kinders en 6 volwassenes.</div>'
    '<div><br></div><div>Vriendelike groete</div><div>Marietjie</div></div><br>'
    '<div class="gmail_quote"><div dir="ltr" class="gmail_attr">Op Do., 8 Okt. 2026 om 11:00 het Farmyard Park '
    '&lt;<a href="mailto:thefarmyardpark@gmail.com">thefarmyardpark@gmail.com</a>&gt; geskryf:<br></div>'
    '<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex"><div dir="ltr">Hallo Marietjie<div>Die 20ste is beskikbaar.</div></div></blockquote></div>'
)
AFRIKAANS_TEXT = (
    "Goeie dag Linda\n\nOns wil graag die 20ste bespreek vir 50 kinders en 6 volwassenes.\n\nVriendelike groete\nMarietjie\n\n"
    "Op Do., 8 Okt. 2026 om 11:00 het Farmyard Park <thefarmyardpark@gmail.com> geskryf:\n\n> Hallo Marietjie\n> Die 20ste is beskikbaar.\n"
)

NO_QUOTE_HTML = (
    '<div dir="ltr">Good morning<div><br></div><div>I would like to enquire about a school outing for 120 learners '
    'on a Thursday in November. What would the cost be and is there a shaded area for lunch?</div><div><br></div>'
    '<div>Thank you</div><div>Peter Abrahams</div><div>HOD Foundation Phase</div><div>Mount Olive Primary</div></div>'
)
NO_QUOTE_TEXT = (
    "Good morning\n\nI would like to enquire about a school outing for 120 learners on a Thursday in November. "
    "What would the cost be and is there a shaded area for lunch?\n\nThank you\nPeter Abrahams\nHOD Foundation Phase\nMount Olive Primary\n"
)

OUR_TEMPLATE_HTML = (
    '<table role="presentation" width="100%"><tr><td><img src="https://admin.farmyardpark.co.za/static/brand/logo-black-600.png" alt="The Farmyard Park" width="160">'
    '<p>Hi Jane</p><p>Please find your proforma FY1703 attached.</p><p>Kind regards<br>Linda Caddick<br>Director<br>'
    'The Farmyard Park (Pty) Ltd<br>081 461 4246 | www.farmyardpark.co.za</p>'
    '<img src="https://tracker.example.com/open.gif" width="1" height="1"></td></tr></table>'
)
OUR_TEMPLATE_TEXT = (
    "Hi Jane\n\nPlease find your proforma FY1703 attached.\n\nKind regards\nLinda Caddick\nDirector\n"
    "The Farmyard Park (Pty) Ltd\n081 461 4246 | www.farmyardpark.co.za\n"
)

TEXT_ONLY_INLINE_ATTRIBUTION_HTML = (
    "<div>Hi Linda<br><br>We confirm 40 people.<br><br>Regards<br>Sam<br><br>"
    "On Wed, Oct 7, 2026 at 9:58 AM Farmyard Park &lt;thefarmyardpark@gmail.com&gt; wrote:<br>"
    "&gt; Hi Sam<br>&gt; Please confirm your numbers.<br></div>"
)
TEXT_ONLY_INLINE_ATTRIBUTION_TEXT = (
    "Hi Linda\n\nWe confirm 40 people.\n\nRegards\nSam\n\n"
    "On Wed, Oct 7, 2026 at 9:58 AM Farmyard Park <thefarmyardpark@gmail.com> wrote:\n> Hi Sam\n> Please confirm your numbers.\n"
)


# ------------------------------------------------------------------- tests ---


def test_gmail_reply_splits_quote_and_signature():
    r = qs.split_message(GMAIL_HTML, GMAIL_TEXT)
    assert r["confidence"] == "high" and r["method"] == "gmail_quote"
    assert "please book the 4th of December" in r["new_html"]
    assert "gmail_quote" not in r["new_html"]
    assert "Thank you for considering" not in r["new_html"]
    assert r["quoted_html"].startswith('<div class="gmail_quote')
    assert "Thank you for considering" in r["quoted_html"]
    assert r["new_text"] == "Hi Linda\n\nThank you, please book the 4th of December for us. We will be 45 learners and 4 teachers."
    assert r["signature_text"] == "Kind regards,\nNolene\nGrade 3 teacher"
    assert "Kind regards" not in r["new_html"] and "Nolene" not in r["new_html"]
    assert r["split_version"] == qs.SPLIT_VERSION


def test_outlook_reply_header_block_and_hr_go_with_the_quote():
    r = qs.split_message(OUTLOOK_HTML, OUTLOOK_TEXT)
    assert r["method"] == "outlook_reply_header" and r["confidence"] == "high"
    assert "much appreciated" in r["new_html"]
    assert "<hr" not in r["new_html"] and "appendonsend" not in r["new_html"]
    assert r["quoted_html"].startswith('<div id="appendonsend">')
    assert "divRplyFwdMsg" in r["quoted_html"] and "the 14th is open" in r["quoted_html"]
    assert r["new_text"] == "Hi Linda,\n\nThank you that will be much appreciated."
    assert r["signature_text"] == "Regards\n\nNicole"
    assert "Nicole" not in r["new_html"]


def test_apple_mail_cite_blockquote_with_attribution_line():
    r = qs.split_message(APPLE_HTML, APPLE_TEXT)
    # Apple Mail puts the "On … wrote:" line inside the cite blockquote itself.
    assert r["method"] == "blockquote_cite" and r["confidence"] == "high"
    assert "<html" not in r["new_html"] and "<body" not in r["new_html"]
    assert "book the date for me" in r["new_html"]
    assert "On 08 Oct 2026" not in r["new_html"]
    assert r["quoted_html"].startswith('<blockquote type="cite"><div>On 08 Oct 2026')
    assert "Thank you for considering" in r["quoted_html"]
    assert r["new_text"].startswith("Hi Linda, hope you are well.")
    assert r["signature_text"] == "Sent from my iPhone"
    assert "Sent from my iPhone" not in r["new_html"]
    assert r["new_text"].endswith("Nolene")


def test_plain_text_original_message_and_device_signature():
    r = qs.split_message(None, PLAIN_TEXT)
    assert r["new_html"] is None and r["quoted_html"] is None
    assert r["confidence"] == "high" and r["method"] == "original_message"
    assert r["new_text"] == "Good day\n\nWe are a church group of about 60 adults and would like to visit on 28 November.\nPlease send me a quote."
    assert r["signature_text"] == "Thanks\nThembakazi\n082 123 4567\n\nSent from my Galaxy"
    assert r["quoted_text"].startswith("-------- Original message --------")


def test_afrikaans_attribution_and_sign_off():
    r = qs.split_message(AFRIKAANS_HTML, AFRIKAANS_TEXT)
    assert r["method"] == "gmail_quote"
    assert "50 kinders" in r["new_html"] and "geskryf" not in r["new_html"]
    assert r["new_text"] == "Goeie dag Linda\n\nOns wil graag die 20ste bespreek vir 50 kinders en 6 volwassenes."
    assert r["signature_text"] == "Vriendelike groete\nMarietjie"
    assert "Die 20ste is beskikbaar" in r["quoted_html"]


def test_no_quote_everything_is_new_and_signature_still_found():
    r = qs.split_message(NO_QUOTE_HTML, NO_QUOTE_TEXT)
    assert r["confidence"] == "none" and r["method"] is None
    assert r["quoted_html"] is None and r["quoted_text"] is None
    assert "120 learners" in r["new_html"]
    assert r["new_text"].startswith("Good morning") and r["new_text"].endswith("shaded area for lunch?")
    assert r["signature_text"] == "Thank you\nPeter Abrahams\nHOD Foundation Phase\nMount Olive Primary"
    assert "Peter Abrahams" not in r["new_html"]


def test_our_own_template_blocks_tracking_pixel_and_allows_own_logo():
    r = qs.split_message(OUR_TEMPLATE_HTML, OUR_TEMPLATE_TEXT, allowed_image_prefixes=("https://admin.farmyardpark.co.za",))
    assert "tracker.example.com" not in r["new_html"]
    assert 'src="https://admin.farmyardpark.co.za/static/brand/logo-black-600.png"' in r["new_html"]
    assert r["new_text"] == "Hi Jane\n\nPlease find your proforma FY1703 attached."
    assert r["signature_text"].startswith("Kind regards\nLinda Caddick\nDirector")
    assert "Linda Caddick" not in r["new_html"]


def test_attribution_without_blockquote_is_located_from_the_text_version():
    r = qs.split_message(TEXT_ONLY_INLINE_ATTRIBUTION_HTML, TEXT_ONLY_INLINE_ATTRIBUTION_TEXT)
    assert r["confidence"] == "medium" and r["method"] == "text_located"
    assert "We confirm 40 people" in r["new_html"]
    assert "Please confirm your numbers" not in r["new_html"]
    assert r["quoted_html"].startswith("On Wed, Oct 7, 2026")
    assert r["new_text"] == "Hi Linda\n\nWe confirm 40 people."
    assert r["signature_text"] == "Regards\nSam"


def test_quote_only_message_fails_open():
    html = '<div dir="auto"><br></div><div class="gmail_quote"><blockquote class="gmail_quote"><p>Forwarded enquiry text</p></blockquote></div>'
    text = "\n\n> Forwarded enquiry text\n"
    r = qs.split_message(html, text)
    assert r["confidence"] == "none"
    assert "Forwarded enquiry text" in r["new_html"] and r["quoted_html"] is None
    assert r["new_text"] == "> Forwarded enquiry text"


def test_signature_only_message_keeps_its_text():
    r = qs.split_message("<div>Thanks<br>Nicole</div>", "Thanks\nNicole\n")
    assert r["new_text"] == "Thanks\nNicole"
    assert r["signature_text"] is None


def test_sign_off_mid_message_is_not_a_signature():
    text = "Thank you so much\n\nWe will arrive at 10:00 with 50 learners and 4 teachers, and we would like to hire two gazebos for the day.\nIs that possible?\n"
    r = qs.split_message(None, text)
    assert r["signature_text"] is None
    assert r["new_text"] == text.strip()


def test_dash_dash_signature_block():
    text = "Hi\n\nPlease send the invoice.\n\n-- \nJohn Smith\nBursar\nSt Mary's\n021 555 1234\n"
    r = qs.split_message(None, text)
    assert r["new_text"] == "Hi\n\nPlease send the invoice."
    assert r["signature_text"].startswith("-- \nJohn Smith")


def test_sanitise_html_strips_scripts_handlers_and_parks_remote_images():
    html = (
        "<p onclick='x()'>Hi</p><script>alert(1)</script><style>p{}</style>"
        '<a href="javascript:void(0)">x</a><img src="https://x.example/a.png" width="300">'
        '<img src="cid:logo"><img src="data:image/png;base64,AAAA"><img src="http://t.example/p.gif" style="width:1px;height:1px">'
    )
    out = qs.sanitise_html(html)
    assert "<script" not in out and "<style" not in out and "onclick" not in out
    assert "javascript:" not in out
    assert 'data-src="https://x.example/a.png"' in out and ' src="https://x.example/a.png"' not in out
    assert 'src="cid:logo"' in out and 'src="data:image/png;base64,AAAA"' in out
    assert "t.example/p.gif" not in out


def test_strip_reply_prefixes_and_count_lines():
    assert qs.strip_reply_prefixes("Re: RE: Fwd: Booking for 30") == "Booking for 30"
    assert qs.strip_reply_prefixes(None) == ""
    assert qs.count_lines("a\r\n\r\nb\nc\n") == 3


@pytest.mark.parametrize(
    "line, expected",
    [
        ("Kind regards,", True),
        ("Regards Nicole", True),
        ("Thanks, Sam", True),
        ("Groete", True),
        ("Thank you for your help with the booking", False),
        ("Best of luck with the planning this term", False),
    ],
)
def test_signoff_regex(line, expected):
    assert bool(qs._SIGNOFF_RE.match(line)) is expected
