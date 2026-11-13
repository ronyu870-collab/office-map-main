// Explicit FK hint keeps the existing relationship unambiguous if other links are added.
export const DISPLAY_OVERRIDE_LIST_FIELDS =
  'id,building_id,field_name,display_label,display_value,created_at,building:buildings!building_display_overrides_building_id_fkey(name)';
