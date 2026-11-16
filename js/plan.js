/* Общие функции для рациона: используются в конструкторе, рецептах, дневнике и списке покупок */
(function () {
  const MEALS = [
    ['breakfast', 'Завтрак', 0.25],
    ['lunch', 'Обед', 0.35],
    ['dinner', 'Ужин', 0.25],
    ['snack', 'Перекус', 0.15],
  ];
  const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const FOOD = Object.fromEntries(window.FOODS.map((f) => [f.id, f]));

  const emptyDay = () => ({ breakfast: [], lunch: [], dinner: [], snack: [] });

  function newDraft() {
    const t = DB.store.get('target');
    return {
      target: (t && t.kcal) || 2000,
      goal: (t && t.goal) || 'maintain',
      mode: 'day',
      day: 0,
      days: Array.from({ length: 7 }, emptyDay),
    };
  }

  const getDraft = () => DB.store.get('diet_draft') || newDraft();
  const saveDraft = (draft) => DB.store.set('diet_draft', draft);

  /* дата в формате ГГГГ-ММ-ДД по местному времени */
  function isoDate(d = new Date()) {
    const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return x.toISOString().slice(0, 10);
  }

  /* номер дня недели в рационе: 0 — понедельник */
  const weekdayIndex = (d = new Date()) => (d.getDay() + 6) % 7;

  /* запись дневника из продукта справочника */
  function diaryEntry(foodId, grams, meal, date) {
    const f = FOOD[foodId];
    const x = f.exact || f; // у рецептов — неокруглённые значения на 100 г
    const k = grams / 100;
    return {
      date, meal, name: f.name, grams,
      kcal: Math.round(x.kcal * k),
      protein: +(x.p * k).toFixed(1),
      fat: +(x.f * k).toFixed(1),
      carbs: +(x.c * k).toFixed(1),
    };
  }

  window.PLAN = { MEALS, DAYS, FOOD, emptyDay, newDraft, getDraft, saveDraft, isoDate, weekdayIndex, diaryEntry };
})();
