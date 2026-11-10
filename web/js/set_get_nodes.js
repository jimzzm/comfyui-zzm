import { app } from "../../../scripts/app.js";

app.registerExtension({
	name: "ai-zzm setNode",
	registerCustomNodes() {
		class SetNode extends LiteGraph.LGraphNode {
			constructor() {
				super("Set");
				if (!this.properties) {
					this.properties = { "previousName": "" };
				}
				this.properties.showOutputText = SetNode.defaultVisibility;

				const node = this;
				node.color = "#C05C43"; // 和 ⚡ AI-zzm 其他节点统一

				this.addWidget("text", "Constant", '',
					() => {
						node.validateName(app.graph);
						if (node.widgets[0].value !== '') {
							node.title = "Set_" + node.widgets[0].value;
						}
						node.update();
						node.properties.previousName = node.widgets[0].value;
					},
					{}
				);

				this.addInput("*", "*");

				// 必须在构造函数里设置，EasyUse v2 就是这样
				this.onConnectionsChange = function (slotType, slot, isChangeConnect, link_info, output) {
					// Disconnect
					if (slotType == 1 && !isChangeConnect) {
						node.inputs[slot].type = '*';
						node.inputs[slot].name = '*';
					}

					// Connect
					if (link_info && slotType == 1 && isChangeConnect) {
						const fromNode = app.graph.getNodeById(link_info.origin_id);
						if (!fromNode) return;
						const type = fromNode.outputs[link_info.origin_slot].type;

						node.title = "Set_" + type;
						node.widgets[0].value = type;
						node.validateName(app.graph);
						node.inputs[0].type = type;
						node.inputs[0].name = type;

						setTimeout(() => {
							if (type != node.widgets[0].value) {
								node.title = "Set_" + node.widgets[0].value;
							}
						}, 1);
					}

					node.update();
				};

				this.isVirtualNode = true;
			}

			validateName(graph) {
				let widgetValue = this.widgets[0].value;
				if (widgetValue != '') {
					let tries = 0;
					let collisions = [];
					do {
						collisions = graph._nodes.filter((otherNode) => {
							if (otherNode == this) return false;
							if (otherNode.type == 'ai-zzm setNode' && otherNode.widgets[0].value === widgetValue) {
								return true;
							}
							return false;
						});
						if (collisions.length > 0) {
							widgetValue = this.widgets[0].value + "_" + tries;
						}
						tries++;
					} while (collisions.length > 0);
					this.widgets[0].value = widgetValue;
					this.update();
				}
			}

			clone() {
				const cloned = SetNode.prototype.clone.apply(this);
				cloned.inputs[0].name = '*';
				cloned.inputs[0].type = '*';
				cloned.properties.previousName = '';
				cloned.size = cloned.computeSize();
				return cloned;
			}

			onAdded(graph) {
				this.validateName(graph);
			}

			update() {
				if (app.graph) {
					this.findGetters(app.graph).forEach((getter) => {
						getter.setType(this.inputs[0].type);
					});
					if (this.widgets[0].value) {
						this.findGetters(app.graph, true).forEach((getter) => {
							getter.setName(this.widgets[0].value);
						});
					}
					const allGetters = app.graph._nodes.filter((otherNode) => otherNode.type == "ai-zzm getNode");
					allGetters.forEach((otherNode) => {
						if (otherNode.setComboValues) {
							otherNode.setComboValues();
						}
					});
				}
			}

			findGetters(graph, checkForPreviousName) {
				const name = checkForPreviousName ? this.properties.previousName : this.widgets[0].value;
				return graph._nodes.filter((otherNode) => {
					if (otherNode.type == 'ai-zzm getNode' && otherNode.widgets[0].value === name && name != '') {
						return true;
					}
					return false;
				});
			}

			onRemoved() {
				const allGetters = this.graph._nodes.filter((otherNode) => otherNode.type == "ai-zzm getNode");
				allGetters.forEach((otherNode) => {
					if (otherNode.setComboValues) {
						otherNode.setComboValues([this]);
					}
				});
			}
		}

		SetNode.defaultVisibility = true;
		SetNode.serialize_widgets = true;

		LiteGraph.registerNodeType(
			"ai-zzm setNode",
			Object.assign(SetNode, { title: "设置 (Set)" })
		);
		SetNode.category = "⚡ zzm工具箱";
	},
});


app.registerExtension({
	name: "ai-zzm getNode",
	registerCustomNodes() {
		class GetNode extends LiteGraph.LGraphNode {
			constructor() {
				super("Get");
				if (!this.properties) {
					this.properties = {};
				}
				this.properties.showOutputText = GetNode.defaultVisibility;

				const node = this;
				node.color = "#C05C43"; // 和 ⚡ AI-zzm 其他节点统一

				this.addWidget("combo", "Constant", "",
					() => { node.onRename(); },
					{
						values: () => {
							const setterNodes = app.graph._nodes.filter((otherNode) => otherNode.type == 'ai-zzm setNode');
							return setterNodes.map((otherNode) => otherNode.widgets[0].value).sort();
						}
					}
				);

				this.addOutput("*", '*');

				// 必须在构造函数里设置
				this.onConnectionsChange = function (slotType, slot, isChangeConnect, link_info, output) {
					node.validateLinks();
					setTimeout(() => {
						node.title = 'Get_' + node.widgets[0].value;
					}, 1);
				};

				this.isVirtualNode = true;
			}

			setName(name) {
				this.widgets[0].value = name;
				this.onRename();
				this.serialize();
			}

			onRename() {
				const setter = this.findSetter(app.graph);
				if (setter) {
					this.setType(setter.inputs[0].type);
					this.title = "Get_" + setter.widgets[0].value;
				} else {
					this.setType('*');
				}
			}

			clone() {
				const cloned = GetNode.prototype.clone.apply(this);
				cloned.size = cloned.computeSize();
				return cloned;
			}

			validateLinks() {
				if (this.outputs[0].type != '*' && this.outputs[0].links) {
					this.outputs[0].links.forEach((linkId) => {
						const link = app.graph.links[linkId];
						if (link && link.type != this.outputs[0].type && link.type != '*') {
							app.graph.removeLink(linkId);
						}
					});
				}
			}

			setType(type) {
				this.outputs[0].name = type;
				this.outputs[0].type = type;
				this.validateLinks();
			}

			findSetter(graph) {
				const name = this.widgets[0].value;
				return graph._nodes.find((otherNode) => {
					if (otherNode.type == 'ai-zzm setNode' && otherNode.widgets[0].value === name && name != '') {
						return true;
					}
					return false;
				});
			}

			onAdded(graph) {
			}
		}

		GetNode.defaultVisibility = true;
		GetNode.serialize_widgets = true;

		LiteGraph.registerNodeType(
			"ai-zzm getNode",
			Object.assign(GetNode, { title: "获取 (Get)" })
		);
		GetNode.category = "⚡ zzm工具箱";
	},
});
