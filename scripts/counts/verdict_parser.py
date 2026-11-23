# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Python port of the agent verdict decoder in scripts/verdict.mjs (parser versions 1 and 2).

Version 1 accepts the whole response as one JSON object, or one JSON/unlabelled code fence with
explanatory prose around it. Version 2 additionally accepts prose followed by one bare JSON
object that ends the response. In both, the prose must not contain another explicit verdict
("status: pass", "verdict = fail", ...) or another JSON object with a "status" key, and the
object must have exactly the keys status, reason and failedAssertion, with status one of
pass, fail, unresolved and no duplicate keys. Anything else decodes as "unresolved".

The JavaScript original locates objects with the acorn expression parser; this port uses
json.JSONDecoder.raw_decode. They agree on JSON objects; opus_reparse.py checks the port by
replaying every recorded response with version 1 and comparing with the recorded decoding.
"""
import json
import re

STATUSES = {'pass', 'fail', 'unresolved'}
# Characters removed by JavaScript String.prototype.trim().
JS_WHITESPACE = '\t\n\v\f\r                  　﻿'
EXPLICIT_VERDICT = re.compile(r'\b(?:status|verdict|result)["\']?\s*[:=]\s*["\']?(?:pass|fail|unresolved)\b', re.I)
FENCE_LINE = re.compile(r'^[ \t]*(`{3,}|~{3,})([^\r\n]*)$')
ANY_FENCE = re.compile(r'^[ \t]*(`{3,}|~{3,})', re.M)
DECODER = json.JSONDecoder(parse_constant=lambda name: (_ for _ in ()).throw(ValueError(name)))


class VerdictError(Exception):
    pass


def js_trim(text):
    return text.strip(JS_WHITESPACE)


def utf16_length(text):
    return len(text.encode('utf-16-le')) // 2


class _Object(dict):
    duplicate = False


def _pairs(pairs):
    obj = _Object(pairs)
    obj.duplicate = len(obj) != len(pairs)
    return obj


def _loads(text):
    return json.loads(text, object_pairs_hook=_pairs, parse_constant=DECODER.parse_constant)


def normalize_assertion(value):
    return re.sub(r'^(?:Then|And)\s+', '', js_trim(value)) if isinstance(value, str) else None


def scenario_assertions(feature, case_id):
    """Then-assertions of one tagged scenario in study/scenarios.feature."""
    blocks = re.split(r'(?=  @)', feature)
    scenario = next((b for b in blocks if b.startswith(f'  @{case_id}\n')), None)
    if scenario is None:
        raise KeyError(f'Frozen scenario not found: {case_id}')
    kind, assertions = None, []
    for line in scenario.split('\n'):
        step = re.match(r'^    (Given|When|Then|And|But) (.+)$', line)
        if not step:
            continue
        if step[1] not in ('And', 'But'):
            kind = step[1]
        if kind == 'Then':
            assertions.append(step[2])
    return assertions


def read_object(text):
    try:
        value = _loads(text)
    except ValueError as error:
        raise VerdictError(f'JSON: {error}')
    if not isinstance(value, dict):
        raise VerdictError('Verdict must be a JSON object')
    if value.duplicate:
        raise VerdictError('Duplicate verdict keys')
    if sorted(value) != ['failedAssertion', 'reason', 'status']:
        raise VerdictError('Verdict requires exactly status, reason and failedAssertion')
    if value['status'] not in STATUSES:
        raise VerdictError('Invalid verdict status')
    reason = value['reason']
    if not isinstance(reason, str) or not js_trim(reason) or utf16_length(reason) > 8000:
        raise VerdictError('Verdict reason must be a nonempty bounded string')
    failed = value['failedAssertion']
    if failed is not None and (not isinstance(failed, str) or not js_trim(failed) or utf16_length(failed) > 2000):
        raise VerdictError('failedAssertion must be a nonempty string or null')
    if value['status'] == 'pass' and failed is not None:
        raise VerdictError('A pass cannot name a failed assertion')
    return value


def check_prose(prose):
    """Reject prose that states another verdict or holds another object with a status key."""
    if EXPLICIT_VERDICT.search(prose):
        raise VerdictError('Additional explicit verdict outside the verdict object')
    starts = [m.start() for m in re.finditer(r'\{', prose)]
    if len(starts) > 256:
        raise VerdictError('Too many JSON-like fragments outside verdict')
    for start in starts:
        try:
            value, _ = DECODER.raw_decode(prose, start)
        except ValueError:
            continue
        if isinstance(value, dict) and 'status' in value:
            raise VerdictError('Additional verdict object outside the verdict object')


def single_fence(text):
    opened, closed, body, outside = None, False, [], []
    for line in re.split(r'\r?\n', text):
        fence = FENCE_LINE.match(line)
        if fence:
            if not opened:
                if not re.match(r'^\s*(?:json)?\s*$', fence[2], re.I):
                    raise VerdictError('Only a JSON or unlabelled fence is allowed')
                opened = fence[1]
            elif not closed and fence[1][0] == opened[0] and len(fence[1]) >= len(opened) and not js_trim(fence[2]):
                closed = True
            else:
                raise VerdictError('Multiple or malformed fences')
        elif opened and not closed:
            body.append(line)
        else:
            outside.append(line)
    if not opened or not closed:
        raise VerdictError('Expected whole JSON or exactly one closed JSON fence')
    check_prose('\n'.join(outside))
    return js_trim('\n'.join(body))


def trailing_object(text):
    """Version 2: prose followed by one JSON object that ends the response."""
    if not text.endswith('}'):
        raise VerdictError('Expected whole JSON, one closed JSON fence, or one JSON object ending the response')
    for match in re.finditer(r'\{', text):
        try:
            value, end = DECODER.raw_decode(text, match.start())
        except ValueError:
            continue
        if not isinstance(value, dict) or end != len(text):
            continue
        prose = text[:match.start()]
        if not js_trim(prose):
            raise VerdictError('Trailing object without prose must be whole JSON')
        check_prose(prose)
        return text[match.start():]
    raise VerdictError('Expected whole JSON, one closed JSON fence, or one JSON object ending the response')


def decode(raw, assertions=(), version=2):
    """Decode one final agent response. Returns status, format and assertion fields."""
    result = {'reportedStatus': 'unresolved', 'verdictFormat': None, 'failedAssertion': None,
              'normalizedFailedAssertion': None, 'failedAssertionVerified': False, 'verdictReason': None,
              'verdictParseError': None}
    try:
        if not isinstance(raw, str) or not js_trim(raw) or utf16_length(raw) > 65536:
            raise VerdictError('Verdict response must be a nonempty bounded string')
        text = js_trim(raw)
        try:
            _loads(text)
            whole = True
        except ValueError:
            whole = False
        if whole:
            obj, fmt = read_object(text), 'whole-json'
        elif version == 1 or ANY_FENCE.search(text):
            obj, fmt = read_object(single_fence(text)), 'single-fenced-json'
        else:
            obj, fmt = read_object(trailing_object(text)), 'trailing-json'
        normalized = normalize_assertion(obj['failedAssertion'])
        result.update(reportedStatus=obj['status'], verdictFormat=fmt, failedAssertion=obj['failedAssertion'],
                      normalizedFailedAssertion=normalized, verdictReason=obj['reason'],
                      failedAssertionVerified=obj['status'] == 'fail' and normalized is not None and normalized in assertions)
    except VerdictError as error:
        result['verdictParseError'] = str(error)
    return result
