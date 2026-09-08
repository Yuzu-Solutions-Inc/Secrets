insert into public.round_templates (key, title, kind, config, is_system)
values
  (
    'team-investigation',
    '{"en":"Team investigation","fr":"Enquête en équipe"}',
    'team',
    '{"durationMinutes":60,"walletMode":"temporary_team","accusationBuzzEnabled":true,"hintBuzzEnabled":true,"accusationStake":500000,"correctTransferPercent":50,"hintPrice":100000,"hintVisibility":"team","completion":"manual"}',
    true
  ),
  (
    'solo-investigation',
    '{"en":"Solo investigation","fr":"Enquête solo"}',
    'solo',
    '{"durationMinutes":45,"walletMode":"personal","accusationBuzzEnabled":true,"hintBuzzEnabled":true,"accusationStake":500000,"correctTransferPercent":50,"hintPrice":100000,"hintVisibility":"private","completion":"manual"}',
    true
  ),
  (
    'house-secret',
    '{"en":"House Secret","fr":"Secret de la maison"}',
    'house_secret',
    '{"durationMinutes":30,"walletMode":"personal","accusationBuzzEnabled":false,"hintBuzzEnabled":true,"accusationStake":500000,"correctTransferPercent":50,"hintPrice":100000,"hintVisibility":"public","completion":"manual"}',
    true
  ),
  (
    'nomination',
    '{"en":"Nominations","fr":"Nominations"}',
    'nomination',
    '{"durationMinutes":15,"walletMode":"personal","accusationBuzzEnabled":false,"hintBuzzEnabled":false,"accusationStake":0,"correctTransferPercent":50,"hintPrice":0,"hintVisibility":"private","completion":"all_submitted"}',
    true
  ),
  (
    'finale',
    '{"en":"Finale","fr":"Finale"}',
    'finale',
    '{"durationMinutes":30,"walletMode":"personal","accusationBuzzEnabled":true,"hintBuzzEnabled":false,"accusationStake":500000,"correctTransferPercent":50,"hintPrice":0,"hintVisibility":"private","completion":"manual"}',
    true
  )
on conflict do nothing;
