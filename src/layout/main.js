/** Gnome libs imports */
const { Shell, Meta, St, GObject, Clutter } = imports.gi;
const Main = imports.ui.main;
const Background = imports.ui.background;

/** Extension imports */
const Me = imports.misc.extensionUtils.getCurrentExtension();
const {
    SetAllocation,
    Allocate,
    AllocatePreferredSize,
} = Me.imports.src.utils.compatibility;
const { MsPanel } = Me.imports.src.layout.panel.panel;
const { reparentActor } = Me.imports.src.utils.index;
const { TranslationAnimator } = Me.imports.src.widget.translationAnimator;

/* exported MsMain */
var MsMain = GObject.registerClass(
    {
        GTypeName: 'MsMain',
    },
    class MsMain extends St.Widget {
        _init() {
            super._init({});
            Me.layout = this;
            this.panelsVisible = Me.stateManager.getState('panels-visible');
            this.panelsVisible =
                this.panelsVisible === undefined ? true : this.panelsVisible;

            Main.uiGroup.insert_child_above(this, global.window_group);

            this.monitorsContainer = [];
            this.aboveContainer = new Clutter.Actor();
            this.add_child(this.aboveContainer);
            this.backgroundGroup = new Meta.BackgroundGroup({});
            this.setBlurBackground(Me.msThemeManager.blurBackground);
            Me.msThemeManager.connect('blur-background-changed', () => {
                this.setBlurBackground(Me.msThemeManager.blurBackground);
            });
            this.add_child(this.backgroundGroup);

            this.primaryMonitorContainer = new PrimaryMonitorContainer(
                this.primaryMonitor,
                this.backgroundGroup,
                {
                    clip_to_allocation: true,
                }
            );
            this.add_child(this.primaryMonitorContainer);
            this.panel = this.primaryMonitorContainer.panel;
            this.primaryMonitorContainer.setMsWorkspaceActor(
                Me.msWorkspaceManager.getActivePrimaryMsWorkspace()
                    .msWorkspaceActor
            );
            for (let externalMonitor of this.externalMonitors) {
                let container = new MonitorContainer(
                    externalMonitor,
                    this.backgroundGroup,
                    {
                        clip_to_allocation: true,
                    }
                );
                this.monitorsContainer.push(container);
                this.add_child(container);
            }

            this.registerToSignals();
            this.onMsWorkspacesChanged();
            this.updatePanelVisibilities();
            this.updateFullscreenMonitors();
        }
        get primaryMonitor() {
            return Main.layoutManager.primaryMonitor;
        }

        get externalMonitors() {
            return Main.layoutManager.monitors.filter(
                (monitor) => monitor !== this.primaryMonitor
            );
        }
        setBlurBackground(blur) {
            const themeContext = St.ThemeContext.get_for_stage(global.stage);
            if ((this.blurEffect && blur) || (!this.blurEffect && !blur)) {
                return;
            } else if (this.blurEffect && !blur) {
                themeContext.disconnect(this._scaleChangedId);
                this.backgroundGroup.remove_effect(this.blurEffect);
                delete this.blurEffect;
                return;
            }

            this.blurEffect = new Shell.BlurEffect({
                brightness: 0.55,
                sigma: 60 * themeContext.scale_factor,
            });

            this._scaleChangedId = themeContext.connect(
                'notify::scale-factor',
                () => {
                    this.blurEffect.sigma = 60 * themeContext.scale_factor;
                }
            );

            this.backgroundGroup.add_effect(this.blurEffect);
        }

        registerToSignals() {
            this.signals = [];

            this.signals.push({
                from: Me.msWorkspaceManager,
                id: Me.msWorkspaceManager.connect(
                    'switch-workspace',
                    (_, from, to) => {
                        this.onSwitchWorkspace(from, to);
                    }
                ),
            });

            this.signals.push({
                from: Me.msWorkspaceManager,
                id: Me.msWorkspaceManager.connect(
                    'dynamic-super-workspaces-changed',
                    () => {
                        this.onMsWorkspacesChanged();
                    }
                ),
            });

            this.signals.push({
                from: Me,
                id: Me.connect('extension-disable', () => {
                    this.aboveContainer.get_children().forEach((actor) => {
                        this.aboveContainer.remove_child(actor);
                        global.window_group.add_child(actor);
                    });
                    this.signals.forEach((signal) => {
                        signal.from.disconnect(signal.id);
                    });
                }),
            });

            this.signals.push({
                from: global.display,
                id: global.display.connect('in-fullscreen-changed', () => {
                    this.updateFullscreenMonitors();
                }),
            });
            this.signals.push({
                from: Main.layoutManager,
                id: Main.layoutManager.connect('monitors-changed', () => {
                    this.primaryMonitorContainer.setMonitor(
                        this.primaryMonitor
                    );

                    let externalMonitorsDiff =
                        Main.layoutManager.monitors.length -
                        1 -
                        this.monitorsContainer.length;
                    // if there are more external monitors
                    if (externalMonitorsDiff > 0) {
                        for (
                            let i = 0;
                            i < Math.abs(externalMonitorsDiff);
                            i++
                        ) {
                            let container = new MonitorContainer(
                                this.externalMonitors[
                                    this.externalMonitors.length -
                                        Math.abs(externalMonitorsDiff) +
                                        i
                                ],
                                this.backgroundGroup,
                                {
                                    clip_to_allocation: true,
                                }
                            );
                            this.monitorsContainer.push(container);
                            this.add_child(container);
                        }
                    }
                    // if there are less external monitors
                    else if (externalMonitorsDiff < 0) {
                        for (
                            let i = 0;
                            i < Math.abs(externalMonitorsDiff);
                            i++
                        ) {
                            let container = this.monitorsContainer.pop();
                            if (container.msWorkspaceActor) {
                                container.remove_child(
                                    container.msWorkspaceActor
                                );
                            }
                            container.destroy();
                        }
                    }

                    this.externalMonitors.forEach((monitor, index) => {
                        this.monitorsContainer[index].setMonitor(monitor);
                    });
                    this.onMsWorkspacesChanged();
                    this.updatePanelVisibilities();
                    this.updateFullscreenMonitors();
                }),
            });
        }

        onMsWorkspacesChanged() {
            this.primaryMonitorContainer.setMsWorkspaceActor(
                Me.msWorkspaceManager.getActivePrimaryMsWorkspace()
                    .msWorkspaceActor
            );
            this.monitorsContainer.forEach((container) => {
                container.setMsWorkspaceActor(
                    Me.msWorkspaceManager.getMsWorkspacesOfMonitorIndex(
                        container.monitor.index
                    )[0].msWorkspaceActor
                );
            });
        }

        onSwitchWorkspace(from, to) {
            this.onMsWorkspacesChanged();
        }

        onTransitionCompleted() {
            /*             this.remove_child(this.translationAnimator);
             */
            this.onMsWorkspacesChanged();
            const activeMsWorkspace = Me.msWorkspaceManager.getActiveMsWorkspace();
            activeMsWorkspace.refreshFocus();
        }

        togglePanelsVisibilities() {
            this.panelsVisible = !this.panelsVisible;
            Me.stateManager.setState('panels-visible', this.panelsVisible);
            this.updatePanelVisibilities();
        }

        updatePanelVisibilities() {
            [
                this.primaryMonitorContainer.panel,
                this.primaryMonitorContainer.topBarSpacer,
                ...this.monitorsContainer.map(
                    (container) => container.topBarSpacer
                ),
            ].forEach((actor) => {
                actor.visible = this.panelsVisible;
                if (this.panelsVisible) {
                    if (Main.layoutManager._findActor(actor) === -1) {
                        Main.layoutManager._trackActor(actor, {
                            affectsStruts: true,
                        });
                    }
                } else {
                    Main.layoutManager._untrackActor(actor);
                }
            });
            Me.msWorkspaceManager.refreshMsWorkspaceUI();
        }

        updateFullscreenMonitors() {
            for (let monitor of Main.layoutManager.monitors) {
                const monitorInFullScreen = global.display.get_monitor_in_fullscreen(
                    monitor.index
                );
                if (monitor === this.primaryMonitor) {
                    this.primaryMonitorContainer.setFullscreen(
                        monitorInFullScreen
                    );
                } else {
                    this.monitorsContainer
                        .find((container) => {
                            return container.monitor === monitor;
                        })
                        .setFullscreen(monitorInFullScreen);
                }
            }
            Me.msWorkspaceManager.refreshMsWorkspaceUI();
        }

        add_child(actor) {
            super.add_child(actor);
            this.set_child_above_sibling(this.aboveContainer, null);
        }

        setActorAbove(actor) {
            reparentActor(actor, this.aboveContainer);
        }
        vfunc_get_preferred_width(_forHeight) {
            let width = global.stage.width;
            return [width, width];
        }

        vfunc_get_preferred_height(_forWidth) {
            let height = global.stage.height;
            return [height, height];
        }
    }
);

/* exported MonitorContainer */
var MonitorContainer = GObject.registerClass(
    {
        GTypeName: 'MonitorContainer',
    },
    class MonitorContainer extends St.Widget {
        _init(monitor, bgGroup, params) {
            super._init(params);
            this.bgGroup = bgGroup;

            this.topBarSpacer = new St.Widget({});
            this.setMonitor(monitor);
            Me.msThemeManager.connect('panel-size-changed', () => {
                this.topBarSpacer.set_height(
                    Me.msThemeManager.getPanelSize(this.monitor.index)
                );
            });
            this.add_child(this.topBarSpacer);
            this.setFullscreen(
                global.display.get_monitor_in_fullscreen(monitor.index)
            );
        }

        setFullscreen(monitorIsFullscreen) {
            this.bgManager.backgroundActor.visible = !monitorIsFullscreen;
            this.topBarSpacer.visible =
                Me.layout.panelsVisible && !monitorIsFullscreen;
        }

        setMsWorkspaceActor(actor) {
            if (actor === this.msWorkspaceActor) return;
            if (
                this.msWorkspaceActor &&
                this.msWorkspaceActor.get_parent() === this
            ) {
                this.remove_child(this.msWorkspaceActor);
            }
            this.msWorkspaceActor = actor;
            reparentActor(this.msWorkspaceActor, this);
        }

        setMonitor(monitor) {
            if (this.bgManager) {
                this.bgManager.destroy();
            }
            this.monitor = monitor;
            this.set_size(monitor.width, monitor.height);
            this.set_position(monitor.x, monitor.y);
            this.topBarSpacer.set_size(
                monitor.width,
                Me.msThemeManager.getPanelSize(monitor.index)
            );
            this.bgManager = new Background.BackgroundManager({
                container: this.bgGroup,
                monitorIndex: monitor.index,
            });
        }

        vfunc_allocate(box, flags) {
            SetAllocation(this, box, flags);
            let themeNode = this.get_theme_node();
            box = themeNode.get_content_box(box);
            if (this.topBarSpacer) {
                AllocatePreferredSize(this.topBarSpacer, flags);
            }
            if (this.msWorkspaceActor) {
                let msWorkspaceActorBox = new Clutter.ActorBox();
                msWorkspaceActorBox.x1 = box.x1;
                msWorkspaceActorBox.x2 = box.x2;
                msWorkspaceActorBox.y1 = box.y1;
                msWorkspaceActorBox.y2 = box.y2;
                Allocate(this.msWorkspaceActor, msWorkspaceActorBox, flags);
            }
        }
    }
);

/* exported PrimaryMonitorContainer */
var PrimaryMonitorContainer = GObject.registerClass(
    {
        GTypeName: 'PrimaryMonitorContainer',
    },
    class PrimaryMonitorContainer extends MonitorContainer {
        _init(monitor, bgGroup, params) {
            this.panel = new MsPanel();
            super._init(monitor, bgGroup, params);
            this.add_child(this.panel);
            this.translationAnimator = new TranslationAnimator(true);
            this.translationAnimator.connect('transition-completed', () => {
                this.remove_child(this.translationAnimator);
                this.add_child(this.msWorkspaceActor);
                if (this.panel) {
                    this.set_child_below_sibling(
                        this.msWorkspaceActor,
                        this.panel
                    );
                }
                this.msWorkspaceActor.msWorkspace.refreshFocus();
            });
        }

        setFullscreen(monitorIsFullscreen) {
            this.panel.visible =
                Me.layout.panelsVisible && !monitorIsFullscreen;
            super.setFullscreen(monitorIsFullscreen);
        }

        setTranslation(prevActor, nextActor) {
            if (!this.translationAnimator.get_parent()) {
                this.translationAnimator.width = this.width;
                this.translationAnimator.height =
                    Main.layoutManager.primaryMonitor.height;
                this.add_child(this.translationAnimator);
                if (this.panel) {
                    this.set_child_below_sibling(
                        this.translationAnimator,
                        this.panel
                    );
                }
            }
            let indexOfPrevActor = Me.msWorkspaceManager.primaryMsWorkspaces.findIndex(
                (msWorkspace) => {
                    return msWorkspace.msWorkspaceActor === prevActor;
                }
            );
            let indexOfNextActor = Me.msWorkspaceManager.primaryMsWorkspaces.findIndex(
                (msWorkspace) => {
                    return msWorkspace.msWorkspaceActor === nextActor;
                }
            );
            prevActor.height = nextActor.height = this.height;
            this.translationAnimator.setTranslation(
                [prevActor],
                [nextActor],
                indexOfNextActor > indexOfPrevActor ? 1 : -1
            );
        }

        setMsWorkspaceActor(actor) {
            if (actor === this.msWorkspaceActor) return;
            let prevActor;
            if (this.msWorkspaceActor) {
                prevActor = this.msWorkspaceActor;
                if (this.msWorkspaceActor.get_parent() === this)
                    this.remove_child(this.msWorkspaceActor);
            }
            this.msWorkspaceActor = actor;
            if (prevActor) {
                this.setTranslation(prevActor, this.msWorkspaceActor);
            } else {
                reparentActor(this.msWorkspaceActor, this);
                if (this.panel) {
                    this.set_child_below_sibling(
                        this.msWorkspaceActor,
                        this.panel
                    );
                }
            }
        }

        vfunc_allocate(box, flags) {
            SetAllocation(this, box, flags);
            let themeNode = this.get_theme_node();
            box = themeNode.get_content_box(box);
            let panelBox = new Clutter.ActorBox();
            if (this.panel) {
                panelBox.x1 = box.x1;
                panelBox.x2 = this.panel.get_preferred_width(-1)[1];
                panelBox.y1 = box.y1;
                panelBox.y2 = this.panel.get_preferred_height(-1)[1];
                Allocate(this.panel, panelBox, flags);
            }
            if (this.topBarSpacer) {
                AllocatePreferredSize(this.topBarSpacer, flags);
            }

            let msWorkspaceActorBox = new Clutter.ActorBox();
            msWorkspaceActorBox.x1 =
                this.panel && this.panel.visible ? panelBox.x2 : box.x1;
            msWorkspaceActorBox.x2 = box.x2;
            msWorkspaceActorBox.y1 = box.y1;
            msWorkspaceActorBox.y2 = box.y2;
            this.get_children()
                .filter(
                    (actor) => actor != this.panel && actor != this.topBarSpacer
                )
                .forEach((child) => {
                    Allocate(child, msWorkspaceActorBox, flags);
                });
        }
    }
);
