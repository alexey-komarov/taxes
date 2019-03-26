#!/usr/bin/node

'use strict';

const fs = require('fs');
const assert = require('assert');
const iconv = new require('iconv').Iconv('windows-1251', 'utf8');

calc(buildTables(getArgs()));

function getDocIndex(table, row) {
	return table.getValue('date_oper', row) + '-' +
		table.getValue('number', row);
}

function calc(tables) {
	const transit = tables.transit;
	const main = tables.main;
	const eur = tables.eur;
	const records = [];
	const courses = {};
	const taxes = [];

	for (let i = 0; i < transit.data.length; i++) {
		if (transit.getValue('d_c', i) === 'D') {
			continue;
		}

		const date = transit.getValue('date_oper', i);
		const rate = transit.getValue('bal_curr', i);

		records.push({
			date: date,
			from: transit.getValue('plat_name', i),
			rub: new Number((transit.getValue('sum_val', i) * rate).toFixed(2))
		});

		courses[date] = new Number(rate);
	}

	let exchange = {};

	for (let i = 0; i < eur.data.length; i++) {
		if (eur.getValue('d_c', i) === 'C') {
			continue;
		}

		courses[eur.getValue('date_oper', i)] =
			new Number(eur.getValue('bal_curr', i));

		exchange[getDocIndex(eur, i)] =
			new Number(eur.getValue('sum_val', i));
	}

	for (let i = 0; i < main.data.length; i++) {
		let date = main.getValue('date_oper', i);
		let sum = new Number(main.getValue('sum_val', i));

		if (main.getValue('d_c', i) === 'D') {
			if (main.getValue('Pol_inn', i) === '2302067397' &&
					main.getValue('TaxPeriod', i).endsWith(tables.year)) {
				taxes.push({
					date: date,
					sum: new Number(sum),
					text: main.getValue('text70', i)
				});
			}

			continue;
		}

		let from = main.getValue('plat_name', i);

		if (from === 'Комаров Алексей Аркадьевич Р/С 40817810108070009726') {
			continue;
		}

		if (from.startsWith('IP KOMAROV ALEKSEI ARKADEVICH')) {
			from = 'Convertation';
			let rate = courses[date];

			if (!rate) {
				abort('No courses');
			}

			let corrSum = exchange[getDocIndex(main, i)];

			if (!corrSum) {
				abort('No correspondent document found for exchange operation');
			}

			var cbSum = rate * corrSum; 

			if (cbSum < sum) {
				sum = new Number((sum - cbSum).toFixed(2));
			} else {
				continue
			}
		}

		records.push({
			date: date,
			from: from,
			rub: sum
		});
	}

	let sum = 0;

	records.forEach(x => {
		console.log(x.date, x.rub, x.from);
		sum += x.rub;
	});

	console.log(sum.toFixed(2));
	let pfr = 0;

	if (sum > 300000) {
		pfr = Number(((sum - 300000) * 0.01).toFixed(2));
	}

	let pay = Math.round(sum * 0.06);
	console.log('--------------------');
	console.log('TAXES', pay);
	console.log('PFR', pfr);
	console.log('--------------------');

	let paid = 0;
	taxes.forEach(x => {
		paid += x.sum;
		console.log('PAID', x.date, x.sum, x.text);
	});

	console.log('--------------------');
	console.log('PAY TAXES', Math.round(pay - paid - pfr));
	console.log('PAY PFR', pfr);
	console.log('PAY TOTAL', (Math.round(pay - paid - pfr) + pfr));
}

function buildTables(args) {
	return {
		year: args.year,
		transit: parseCsv('transit', args.transitAccFile),
		main: parseCsv('main', args.mainAccFile),
		eur: parseCsv('eur', args.eurAccFile)
	};
}

function parseCsv(table, data) {
	const lines = data.split(/\n/);

	return {
		fields: lines.shift().split(/\t+/),
		columns: lines.shift().split(/\t+/),
		data: lines.map(line => line.split(/\t/)),
		getValue: function(field, row) {
			let idx = this.fields.indexOf(field);

			assert(idx > -1, 'No field "' + field + '" in table " ' +
				table + '" ');

			return this.data[row][idx];
		}
	};
}

function help(err) {
	console.error(err);
	console.error(process.argv[1].split('/').pop() + ' year');
	process.exit(1);
}

function abort(err) {
	console.error(err);
	process.exit(2);
}

function getIntArg(idx, name, regExp) {
	const val = process.argv[idx];

	if (val && val.match(regExp)) {
		return parseInt(val);
	}

	help('Invalid ' + name + ': "' + (val || '') + '"');
}

function getArgs() {
	return readData({
		year: getIntArg(2, 'year', new RegExp(/^\d+$/))
	});
}

function checkPath(path) {
	if (!fs.existsSync(path)) {
		abort('No directory: ' + path);
	}

	if (!fs.statSync(path).isDirectory()) {
		abort('Not a directory: ' + path);
	}

	return path;
}

function readFile(path) {
	if (!fs.existsSync(path)) {
		abort('No file: ' + path);
	}

	if (!fs.statSync(path).isFile()) {
		abort('Not a file: ' + path);
	}

	return iconv.convert(fs.readFileSync(path)).toString();
}

function readData(args) {
	let path = checkPath('data/' + args.year.toString());
	args.transitAccFile = readFile(path + '/transit.csv');
	args.mainAccFile = readFile(path + '/main.csv');
	args.eurAccFile = readFile(path + '/eur.csv');
	return args;
}
