use jacobe_skills_lib::windows::{
    choose_work_area, choose_work_area_for_rect, clamp_rect, place_quick_panel, snap_orb,
    ExpandDirection, HorizontalEdge, Point, WindowRect, WorkArea, ORB_SIZE, QUICK_HEIGHT,
    QUICK_WIDTH, WINDOW_MARGIN,
};

const PRIMARY: WorkArea = WorkArea {
    x: 0,
    y: 0,
    width: 1920,
    height: 1040,
};

#[test]
fn selects_negative_coordinate_monitor() {
    let left = WorkArea {
        x: -1280,
        y: -120,
        width: 1280,
        height: 984,
    };
    assert_eq!(
        choose_work_area(Point { x: -600, y: 100 }, &[PRIMARY, left]),
        Some(left)
    );
}

#[test]
fn selects_right_monitor_from_window_center() {
    let right = WorkArea {
        x: 1920,
        y: 40,
        width: 2560,
        height: 1400,
    };
    let rect = WindowRect {
        x: 2100,
        y: 200,
        width: ORB_SIZE,
        height: ORB_SIZE,
    };
    assert_eq!(
        choose_work_area_for_rect(rect, &[PRIMARY, right]),
        Some(right)
    );
}

#[test]
fn outside_all_displays_chooses_nearest_work_area() {
    let right = WorkArea {
        x: 1920,
        y: 0,
        width: 1920,
        height: 1040,
    };
    assert_eq!(
        choose_work_area(Point { x: 4100, y: 500 }, &[PRIMARY, right]),
        Some(right)
    );
}

#[test]
fn equal_distance_monitor_choice_is_stable() {
    let left = WorkArea {
        x: -100,
        y: 0,
        width: 100,
        height: 100,
    };
    let right = WorkArea {
        x: 100,
        y: 0,
        width: 100,
        height: 100,
    };
    assert_eq!(
        choose_work_area(Point { x: 50, y: 50 }, &[left, right]),
        Some(left)
    );
}

#[test]
fn snap_respects_taskbar_reduced_work_area() {
    let input = WindowRect {
        x: 1870,
        y: 1100,
        width: ORB_SIZE,
        height: ORB_SIZE,
    };
    let (snapped, edge) = snap_orb(input, PRIMARY);
    assert_eq!(edge, HorizontalEdge::Right);
    assert_eq!(snapped.x, 1920 - ORB_SIZE as i32 - WINDOW_MARGIN);
    assert_eq!(snapped.y, 1040 - ORB_SIZE as i32);
}

#[test]
fn snap_tie_goes_left_deterministically() {
    let input = WindowRect {
        x: 960 - ORB_SIZE as i32 / 2,
        y: 300,
        width: ORB_SIZE,
        height: ORB_SIZE,
    };
    let (snapped, edge) = snap_orb(input, PRIMARY);
    assert_eq!(edge, HorizontalEdge::Left);
    assert_eq!(snapped.x, WINDOW_MARGIN);
}

#[test]
fn quick_panel_expands_inward_from_each_edge() {
    let left_orb = WindowRect {
        x: WINDOW_MARGIN,
        y: 300,
        width: ORB_SIZE,
        height: ORB_SIZE,
    };
    let right_orb = WindowRect {
        x: 1920 - ORB_SIZE as i32 - WINDOW_MARGIN,
        ..left_orb
    };
    let left = place_quick_panel(left_orb, PRIMARY);
    let right = place_quick_panel(right_orb, PRIMARY);
    assert_eq!(left.direction, ExpandDirection::Right);
    assert!(left.rect.x > left_orb.x);
    assert_eq!(right.direction, ExpandDirection::Left);
    assert!(right.rect.x < right_orb.x);
}

#[test]
fn quick_panel_is_vertically_clamped() {
    let orb = WindowRect {
        x: WINDOW_MARGIN,
        y: 0,
        width: ORB_SIZE,
        height: ORB_SIZE,
    };
    let placement = place_quick_panel(orb, PRIMARY);
    assert_eq!(placement.rect.y, 0);
    assert_eq!(placement.rect.height, QUICK_HEIGHT);
}

#[test]
fn small_work_area_shrinks_windows_without_overflow() {
    let tiny = WorkArea {
        x: -40,
        y: 20,
        width: 300,
        height: 240,
    };
    let placement = place_quick_panel(
        WindowRect {
            x: -32,
            y: 80,
            width: ORB_SIZE,
            height: ORB_SIZE,
        },
        tiny,
    );
    assert_eq!(placement.rect.width, tiny.width.min(QUICK_WIDTH));
    assert_eq!(placement.rect.height, tiny.height.min(QUICK_HEIGHT));
    assert_eq!(placement.rect.x, tiny.x);
    assert_eq!(placement.rect.y, tiny.y);

    let clamped = clamp_rect(
        WindowRect {
            x: -500,
            y: -500,
            width: 500,
            height: 500,
        },
        tiny,
    );
    assert_eq!(clamped.width, tiny.width);
    assert_eq!(clamped.height, tiny.height);
    assert_eq!(clamped.x, tiny.x);
    assert_eq!(clamped.y, tiny.y);
}
