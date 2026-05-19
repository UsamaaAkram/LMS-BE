const ones = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];

const tens = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

function convertHundreds(num) {
  let result = "";
  if (num >= 100) {
    result += ones[Math.floor(num / 100)] + " Hundred";
    num %= 100;
    if (num > 0) result += " ";
  }
  if (num >= 20) {
    result += tens[Math.floor(num / 10)];
    num %= 10;
    if (num > 0) result += " ";
  }
  if (num > 0) {
    result += ones[num];
  }
  return result;
}

function amountToWords(amount) {
  if (amount === 0) return "Rupees Zero Only";

  let num = Math.floor(Math.abs(amount));
  let words = "";

  if (num >= 10000000) {
    words += convertHundreds(Math.floor(num / 10000000)) + " Crore ";
    num %= 10000000;
  }
  if (num >= 100000) {
    words += convertHundreds(Math.floor(num / 100000)) + " Lakh ";
    num %= 100000;
  }
  if (num >= 1000) {
    words += convertHundreds(Math.floor(num / 1000)) + " Thousand ";
    num %= 1000;
  }
  if (num >= 100) {
    words += convertHundreds(Math.floor(num / 100) * 100 + (num % 100));
  } else if (num > 0) {
    words += convertHundreds(num);
  }

  return `Rupees ${words.trim()} Only`;
}

module.exports = amountToWords;