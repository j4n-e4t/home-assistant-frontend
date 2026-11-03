import {
  mdiAccount,
  mdiFile,
  mdiOpenInNew,
  mdiPencilOutline,
  mdiWeb,
} from "@mdi/js";
import type { RequestSelectedDetail } from "@material/mwc-list/mwc-list-item";
import Fuse from "fuse.js";
import type { CSSResultGroup } from "lit";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators";
import memoizeOne from "memoize-one";
import type { HASSDomTargetEvent } from "../../../common/dom/fire_event";
import { fireEvent } from "../../../common/dom/fire_event";
import { shouldHandleRequestSelectedEvent } from "../../../common/mwc/handle-request-selected-event";
import { stringCompare } from "../../../common/string/compare";
import { ADAPTIVE_DIALOG_MEDIA_QUERY } from "../../../components/ha-adaptive-dialog";
import "../../../components/ha-icon-next";
import "../../../components/ha-list";
import type { HaList } from "../../../components/ha-list";
import "../../../components/ha-list-item";
import type { HaListItem } from "../../../components/ha-list-item";
import "../../../components/ha-spinner";
import "../../../components/ha-tip";
import "../../../components/input/ha-input-search";
import type { HaInputSearch } from "../../../components/input/ha-input-search";
import { showAutomationEditor } from "../../../data/automation";
import type {
  Blueprint,
  BlueprintDomain,
  BlueprintSourceType,
  Blueprints,
} from "../../../data/blueprint";
import {
  fetchBlueprints,
  getBlueprintSourceType,
} from "../../../data/blueprint";
import { showScriptEditor } from "../../../data/script";
import {
  type FuseWeightedKey,
  multiTermSortedSearch,
} from "../../../resources/fuseMultiTerm";
import { mdiHomeAssistant } from "../../../resources/home-assistant-logo-svg";
import { haStyle, haStyleDialog } from "../../../resources/styles";
import type { HomeAssistant } from "../../../types";
import { documentationUrl } from "../../../util/documentation-url";
import type { NewAutomationDialogParams } from "./show-dialog-new-automation";

const SOURCE_TYPE_ICONS: Record<BlueprintSourceType, string> = {
  local: mdiFile,
  community: mdiAccount,
  homeassistant: mdiHomeAssistant,
};

type BlueprintListItem = HaListItem & { path: string };

const BLUEPRINT_SEARCH_KEYS: FuseWeightedKey[] = [
  { name: "name", weight: 10 },
  { name: "description", weight: 7 },
  { name: "author", weight: 5 },
];

@customElement("ha-dialog-new-automation")
class DialogNewAutomation extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private _open = false;

  @state() private _params?: NewAutomationDialogParams;

  @state() private _mode: BlueprintDomain = "automation";

  @state() public blueprints?: Blueprints;

  @state() private _loadingBlueprints = false;

  @state() private _filter = "";

  @query("ha-input-search") private _searchInput?: HaInputSearch;

  @query("ha-list") private _list?: HaList;

  public showDialog(params: NewAutomationDialogParams): void {
    this._params = params;
    this._open = true;
    this._mode = params?.mode || "automation";
    this._filter = "";
    this.blueprints = undefined;
    this._loadingBlueprints = true;

    fetchBlueprints(this.hass!.callWS, this._mode)
      .then((blueprints) => {
        this.blueprints = blueprints;
      })
      .finally(async () => {
        this._loadingBlueprints = false;
        await this._focusSearchInput();
      });
  }

  private async _focusSearchInput() {
    // The search input is only rendered once blueprints have loaded, so the
    // dialog's `autofocus` handling has already run. Skip in bottom sheet mode
    // to avoid popping up the on-screen keyboard on touch devices.
    if (matchMedia(ADAPTIVE_DIALOG_MEDIA_QUERY).matches) {
      return;
    }
    await this.updateComplete;
    const searchInput = this._searchInput;
    if (!searchInput) {
      return;
    }
    await searchInput.updateComplete;
    searchInput.focus();
  }

  public closeDialog(): void {
    this._open = false;
  }

  private _dialogClosed(): void {
    this._params = undefined;
    this.blueprints = undefined;
    this._loadingBlueprints = false;
    this._filter = "";
    fireEvent(this, "dialog-closed", { dialog: this.localName });
  }

  private _processedBlueprints = memoizeOne((blueprints?: Blueprints) => {
    if (!blueprints) {
      return [];
    }
    const result = Object.entries(blueprints)
      .filter((entry): entry is [string, Blueprint] => !("error" in entry[1]))
      .map(([path, blueprint]) => {
        const sourceType = getBlueprintSourceType(blueprint);

        return {
          ...blueprint.metadata,
          sourceType,
          path,
        };
      });
    return result.sort((a, b) =>
      stringCompare(a.name, b.name, this.hass!.locale.language)
    );
  });

  private _blueprintFuseIndex = memoizeOne(
    (blueprints: ReturnType<DialogNewAutomation["_processedBlueprints"]>) =>
      Fuse.createIndex(BLUEPRINT_SEARCH_KEYS, blueprints)
  );

  private _filteredBlueprints = memoizeOne(
    (
      blueprints: ReturnType<DialogNewAutomation["_processedBlueprints"]>,
      filter: string
    ) =>
      multiTermSortedSearch(
        blueprints,
        filter,
        (blueprint) => blueprint.path,
        this._blueprintFuseIndex(blueprints)
      )
  );

  protected render() {
    if (!this._params) {
      return nothing;
    }

    const processedBlueprints = this._processedBlueprints(this.blueprints);
    const filteredBlueprints = this._filteredBlueprints(
      processedBlueprints,
      this._filter
    );

    return html`
      <ha-adaptive-dialog
        .open=${this._open}
        flexcontent
        header-title=${this.hass.localize(
          `ui.panel.config.${this._mode}.dialog_new.header`
        )}
        @closed=${this._dialogClosed}
      >
        <div class="content-wrapper">
          ${
            processedBlueprints.length > 5
              ? html`<ha-input-search
                  appearance="outlined"
                  .value=${this._filter}
                  .placeholder=${this.hass.localize(
                    `ui.panel.config.${this._mode}.dialog_new.search_blueprints`
                  )}
                  @input=${this._handleSearchChange}
                  @keydown=${this._handleSearchKeyDown}
                ></ha-input-search>`
              : nothing
          }
          <div class="list-container ha-scrollbar">
            <ha-list @keydown=${this._handleListKeyDown}>
              <ha-list-item
                hasmeta
                twoline
                graphic="icon"
                @request-selected=${this._blank}
              >
                <ha-svg-icon
                  slot="graphic"
                  .path=${mdiPencilOutline}
                ></ha-svg-icon>
                ${this.hass.localize(
                  `ui.panel.config.${this._mode}.dialog_new.create_empty`
                )}
                <span slot="secondary">
                  ${this.hass.localize(
                    `ui.panel.config.${this._mode}.dialog_new.create_empty_description`
                  )}
                </span>
                <ha-icon-next slot="meta"></ha-icon-next>
              </ha-list-item>
              ${
                this._loadingBlueprints
                  ? nothing
                  : html`
                      ${filteredBlueprints.map(
                        (blueprint) => html`
                          <ha-list-item
                            hasmeta
                            twoline
                            graphic="icon"
                            @request-selected=${this._blueprintSelected}
                            .path=${blueprint.path}
                          >
                            <ha-svg-icon
                              slot="graphic"
                              .path=${SOURCE_TYPE_ICONS[blueprint.sourceType]}
                            ></ha-svg-icon>
                            ${blueprint.name}
                            <span slot="secondary">
                              ${
                                blueprint.author
                                  ? this.hass.localize(
                                      `ui.panel.config.${this._mode}.dialog_new.blueprint_source.author`,
                                      { author: blueprint.author }
                                    )
                                  : this.hass.localize(
                                      `ui.panel.config.${this._mode}.dialog_new.blueprint_source.${blueprint.sourceType}`
                                    )
                              }
                            </span>
                            <ha-icon-next slot="meta"></ha-icon-next>
                          </ha-list-item>
                        `
                      )}
                    `
              }
            </ha-list>
            ${
              this._loadingBlueprints
                ? html`<div class="spinner">
                    <ha-spinner></ha-spinner>
                  </div>`
                : html`
                    ${
                      processedBlueprints.length === 0
                        ? html`
                            <a
                              href=${documentationUrl(
                                this.hass,
                                "/get-blueprints"
                              )}
                              target="_blank"
                              rel="noreferrer noopener"
                              class="item"
                            >
                              <ha-list-item hasmeta twoline graphic="icon">
                                <ha-svg-icon
                                  slot="graphic"
                                  .path=${mdiWeb}
                                ></ha-svg-icon>
                                ${this.hass.localize(
                                  `ui.panel.config.${this._mode}.dialog_new.create_blueprint`
                                )}
                                <span slot="secondary">
                                  ${this.hass.localize(
                                    `ui.panel.config.${this._mode}.dialog_new.create_blueprint_description`
                                  )}
                                </span>
                                <ha-svg-icon
                                  slot="meta"
                                  path=${mdiOpenInNew}
                                ></ha-svg-icon>
                              </ha-list-item>
                            </a>
                          `
                        : filteredBlueprints.length === 0
                          ? html`
                              <div class="empty-search">
                                ${this.hass.localize(
                                  `ui.panel.config.${this._mode}.dialog_new.no_blueprints_match_search`
                                )}
                              </div>
                            `
                          : nothing
                    }
                    ${
                      processedBlueprints.length > 0
                        ? html`
                            <ha-tip>
                              <a
                                href=${documentationUrl(
                                  this.hass,
                                  "/get-blueprints"
                                )}
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                ${this.hass.localize(
                                  `ui.panel.config.${this._mode}.dialog_new.discover_blueprint_tip`
                                )}
                              </a>
                            </ha-tip>
                          `
                        : nothing
                    }
                  `
            }
          </div>
        </div>
      </ha-adaptive-dialog>
    `;
  }

  private _handleSearchChange(ev: HASSDomTargetEvent<HaInputSearch>) {
    this._filter = ev.target.value ?? "";
  }

  private _handleSearchKeyDown(ev: KeyboardEvent) {
    if (ev.key === "ArrowDown") {
      if (this._list?.items.length) {
        ev.preventDefault();
        this._list.focusItemAtIndex(0);
      }
      return;
    }
    if (ev.key !== "Enter" || ev.isComposing || !this._filter.trim()) {
      return;
    }
    const [firstMatch] = this._filteredBlueprints(
      this._processedBlueprints(this.blueprints),
      this._filter
    );
    if (firstMatch) {
      ev.preventDefault();
      this._openBlueprint(firstMatch.path);
    }
  }

  private _handleListKeyDown(ev: KeyboardEvent) {
    if (
      ev.key === "ArrowUp" &&
      this._searchInput &&
      this._list?.getFocusedItemIndex() === 0
    ) {
      ev.preventDefault();
      ev.stopPropagation();
      this._searchInput.focus();
    }
  }

  private _blueprintSelected(
    ev: CustomEvent<RequestSelectedDetail> & {
      currentTarget: BlueprintListItem;
    }
  ) {
    if (!shouldHandleRequestSelectedEvent(ev)) {
      return;
    }
    this._openBlueprint(ev.currentTarget.path);
  }

  private _openBlueprint(path: string) {
    if (this._mode === "script") {
      showScriptEditor({ use_blueprint: { path } });
    } else {
      showAutomationEditor({ use_blueprint: { path } });
    }
  }

  private async _blank(ev) {
    if (!shouldHandleRequestSelectedEvent(ev)) {
      return;
    }
    if (this._mode === "script") {
      showScriptEditor();
    } else {
      showAutomationEditor();
    }
  }

  static get styles(): CSSResultGroup {
    return [
      haStyle,
      haStyleDialog,
      css`
        ha-adaptive-dialog {
          --dialog-content-padding: 0;
          --ha-dialog-min-height: min(
            720px,
            calc(
              100dvh - max(
                  var(--safe-area-inset-bottom),
                  var(--ha-space-4)
                ) - max(var(--safe-area-inset-top), var(--ha-space-4))
            )
          );
          --ha-dialog-max-height: var(--ha-dialog-min-height);
        }
        :host {
          --ha-bottom-sheet-height: min(85vh, 85dvh);
          --ha-bottom-sheet-max-height: min(85vh, 85dvh);
        }
        @media all and (min-width: 550px) {
          ha-adaptive-dialog {
            --mdc-dialog-min-width: 500px;
          }
        }
        .content-wrapper {
          display: flex;
          flex-direction: column;
          min-height: 0;
          height: 100%;
        }
        ha-input-search {
          flex: none;
          margin: 0 var(--ha-space-4) var(--ha-space-2);
        }
        .list-container {
          flex: 1;
          overflow-y: auto;
          min-height: 0;
          padding-bottom: var(--ha-space-2);
        }
        .spinner {
          display: flex;
          justify-content: center;
          padding: var(--ha-space-8) 0;
        }
        ha-icon-next {
          width: 24px;
        }
        ha-tip {
          margin: var(--ha-space-2) var(--ha-space-4);
        }
        .empty-search {
          color: var(--secondary-text-color);
          padding: var(--ha-space-4);
        }
        a.item {
          text-decoration: unset;
        }
      `,
    ];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-dialog-new-automation": DialogNewAutomation;
  }
}
