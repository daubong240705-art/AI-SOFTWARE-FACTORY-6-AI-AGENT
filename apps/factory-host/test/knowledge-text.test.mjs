import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeForSearch, buildMatchQuery, snippetOf } from "../dist/knowledge/text.js";

const cases = [
  ["Thiết kế", "thiet ke"], ["Đăng nhập", "dang nhap"], ["Đặc tả", "dac ta"], ["Nghiên cứu", "nghien cuu"],
  ["THIẾT KẾ", "thiet ke"], ["ĐĂNG NHẬP", "dang nhap"], ["ĐẶC TẢ", "dac ta"], ["NGHIÊN CỨU", "nghien cuu"],
  ["đĐdD", "dddd"], ["đường dẫn", "duong dan"], ["ĐỒNG BỘ", "dong bo"], ["Tiếng Việt", "tieng viet"],
  ["a à á ả ã ạ", "a a a a a a"], ["ă ằ ắ ẳ ẵ ặ", "a a a a a a"], ["â ầ ấ ẩ ẫ ậ", "a a a a a a"],
  ["e è é ẻ ẽ ẹ", "e e e e e e"], ["ê ề ế ể ễ ệ", "e e e e e e"], ["i ì í ỉ ĩ ị", "i i i i i i"],
  ["o ò ó ỏ õ ọ", "o o o o o o"], ["ô ồ ố ổ ỗ ộ", "o o o o o o"], ["ơ ờ ớ ở ỡ ợ", "o o o o o o"],
  ["u ù ú ủ ũ ụ", "u u u u u u"], ["ư ừ ứ ử ữ ự", "u u u u u u"], ["y ỳ ý ỷ ỹ ỵ", "y y y y y y"],
  ["A À Á Ả Ã Ạ", "a a a a a a"], ["Ă Ằ Ắ Ẳ Ẵ Ặ", "a a a a a a"], ["Â Ầ Ấ Ẩ Ẫ Ậ", "a a a a a a"],
  ["E È É Ẻ Ẽ Ẹ", "e e e e e e"], ["Ê Ề Ế Ể Ễ Ệ", "e e e e e e"], ["I Ì Í Ỉ Ĩ Ị", "i i i i i i"],
  ["O Ò Ó Ỏ Õ Ọ", "o o o o o o"], ["Ô Ồ Ố Ổ Ỗ Ộ", "o o o o o o"], ["Ơ Ờ Ớ Ở Ỡ Ợ", "o o o o o o"],
  ["U Ù Ú Ủ Ũ Ụ", "u u u u u u"], ["Ư Ừ Ứ Ử Ữ Ự", "u u u u u u"], ["Y Ỳ Ý Ỷ Ỹ Ỵ", "y y y y y y"],
  ["Thiết kế", "thiet ke"], ["Đăng nhập", "dang nhap"], ["Đặc tả", "dac ta"], ["nghiên cứu", "nghien cuu"],
  ["English SEARCH", "english search"], ["Hello, world!", "hello world"], [" hello   world ", "hello world"],
  ["a\tb\nc\rd", "a b c d"], ["a\u0000b\u0007c", "a b c"], ["a😀b", "a b"], ["😀🎉", ""],
  ["", ""], ["   \n\t", ""], ["!@#$%^&*()", ""], ["123 456", "123 456"], ["a_b-c+d", "a b c d"],
  ["café déjà vu", "cafe deja vu"], ["naïve façade", "naive facade"], ["中文 日本語", "中文 日本語"],
  ["Русский ТЕКСТ", "русскии текст"], ["ＡＢＣ１２３", "ａｂｃ１２３"], ["a\u200db", "a b"],
  ["a\u0301\u0300\u0303", "a"], ["Đ2 API v3", "d2 api v3"], ["title:secret", "title secret"],
];
for (const [i, [input, expected]] of cases.entries()) {
  test(`normalization case ${i + 1}`, () => assert.equal(normalizeForSearch(input), expected));
  test(`normalization is idempotent case ${i + 1}`, () => {
    const normalized = normalizeForSearch(input);
    assert.equal(normalizeForSearch(normalized), normalized);
    assert.equal(normalizeForSearch(input.normalize("NFD")), normalized);
    assert.equal(normalizeForSearch(input.normalize("NFC")), normalized);
  });
}
for (const [i, [input, expected]] of [
  ["thiet ke", '"thiet" "ke"*'], ["Thiết kế", '"thiet" "ke"*'], ["Đăng nhập", '"dang" "nhap"*'],
  ["title:secret", '"title" "secret"*'], ["a OR b", '"a" "or" "b"*'], ["NEAR(a b)", '"near" "a" "b"*'],
  ['"unbalanced', '"unbalanced"*'], ["x*", '"x"*'], ["-y", '"y"*'], ["^z", '"z"*'],
  ["x + y", '"x" "y"*'], ["NOT AND OR NEAR", '"not" "and" "or" "near"*'],
  ["a\u0000b\n", '"a" "b"*'], ["' OR 1=1 --", '"or" "1" "1"*'],
  ["", null], [" ", null], ["*** : ()", null], ["😀", null], ["\u0000\u0001", null],
].entries()) test(`safe match case ${i + 1}`, () => assert.equal(buildMatchQuery(input), expected));
test("last prefix can be disabled", () => assert.equal(buildMatchQuery("Thiết kế", { prefixLast: false }), '"thiet" "ke"'));
test("term count is bounded", () => assert.equal(buildMatchQuery("a b c d", { maxTerms: 2 }), '"a" "b"*'));
test("term length is bounded", () => assert.equal(buildMatchQuery("abcdefgh", { maxTermLength: 3 }), '"abc"*'));
test("default term count is twelve", () => assert.equal(buildMatchQuery("x ".repeat(100)).split(" ").length, 12));
test("huge input stays bounded", () => assert.equal(buildMatchQuery("Đ".repeat(100 * 1024)), `"${"d".repeat(64)}"*`));
test("huge punctuation has no terms", () => assert.equal(buildMatchQuery("*".repeat(100 * 1024)), null));
test("huge mixed input normalizes deterministically", () => assert.equal(normalizeForSearch("Đặc tả! ".repeat(15000)), "dac ta ".repeat(15000).trim()));
for (const maxTerms of [0, -1, 1.5, Infinity, NaN]) test(`invalid term budget ${String(maxTerms)}`, () => assert.equal(buildMatchQuery("a", { maxTerms }), null));
test("snippet preserves Vietnamese original", () => assert.equal(snippetOf("Thiết kế đăng nhập", 8), "Thiết kế"));
test("snippet preserves Unicode code points", () => assert.equal(snippetOf("a😀b", 2), "a😀"));
test("snippet empty and zero limits", () => { assert.equal(snippetOf("", 5), ""); assert.equal(snippetOf("abc", 0), ""); });
test("snippet keeps original punctuation and controls", () => assert.equal(snippetOf("Đ!\nx", 3), "Đ!\n"));
