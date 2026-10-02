export const UNIT_PRICE = 1000;

export const TOPPINGS = [
  'Trân châu đen',
  'Trân châu trắng',
  'Thạch rau câu',
  'Pudding trứng',
  'Bánh flan',
  'Thạch phô mai',
  'Thạch trái cây',
  'Sương sáo',
  'Khúc bạch'
];

export const SHIFTS = [
  { id: 'morning', label: 'Ca Sáng' },
  { id: 'afternoon', label: 'Ca Chiều' },
  { id: 'evening', label: 'Ca Tối' }
];

export function normalizeQuantity(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

export function calculateShiftTotals(quantities, toppingTypes = TOPPINGS) {
  const totalToppings = quantities.reduce((total, quantity) => total + normalizeQuantity(quantity), 0);
  const totalMoney = quantities.reduce((total, quantity) => {
    return total + normalizeQuantity(quantity) * UNIT_PRICE;
  }, 0);
  return { totalToppings, totalMoney };
}

export function calculateRecordsTotals(records, toppingTypes = TOPPINGS) {
  return records.reduce((total, record) => {
    const shift = calculateShiftTotals(record.quantities || [], toppingTypes);
    total.shiftCount += 1;
    total.totalToppings += shift.totalToppings;
    total.totalMoney += shift.totalMoney;
    return total;
  }, { shiftCount: 0, totalToppings: 0, totalMoney: 0 });
}

export function calculateEmployeeTotals(records, toppingTypes = TOPPINGS) {
  const employees = new Map();
  records.forEach((record) => {
    const name = record.employee.trim();
    const totals = employees.get(name) || { name, shiftCount: 0, totalToppings: 0, totalMoney: 0 };
    const shift = calculateShiftTotals(record.quantities || [], toppingTypes);
    totals.shiftCount += 1;
    totals.totalToppings += shift.totalToppings;
    totals.totalMoney += shift.totalMoney;
    employees.set(name, totals);
  });
  return [...employees.values()].sort((left, right) => left.name.localeCompare(right.name, 'vi'));
}

export function calculateToppingTotals(records, toppingTypes = TOPPINGS) {
  const totals = toppingTypes.map((type) => ({
    name: typeof type === 'string' ? type : type.name,
    unitPrice: UNIT_PRICE,
    quantity: 0,
    revenue: 0
  }));
  records.forEach((record) => {
    (record.quantities || []).forEach((quantity, index) => {
      if (totals[index]) {
        totals[index].quantity += normalizeQuantity(quantity);
        totals[index].revenue += normalizeQuantity(quantity) * totals[index].unitPrice;
      }
    });
  });
  return totals;
}

export function calculateToppingSummary(records, toppingTypes = TOPPINGS) {
  const toppings = calculateToppingTotals(records, toppingTypes);
  return toppings.reduce((summary, topping) => {
    summary.totalToppings += topping.quantity;
    summary.totalMoney += topping.revenue;
    return summary;
  }, { toppings, totalToppings: 0, totalMoney: 0 });
}